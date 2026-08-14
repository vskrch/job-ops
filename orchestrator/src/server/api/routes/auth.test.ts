import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe("Auth API & Multi-User End-to-End", () => {
  let context: Awaited<ReturnType<typeof startServer>>;

  beforeEach(async () => {
    context = await startServer({
      env: {
        SESSION_SECRET: "test-session-secret-for-auth-unit-tests-12345",
      },
    });
  });

  afterEach(async () => {
    await stopServer(context);
  });

  it("registers a new user and sets a valid session cookie", async () => {
    const res = await fetch(`${context.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "alice@example.com",
        password: "password123",
        name: "Alice Developer",
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.user.email).toBe("alice@example.com");
    expect(body.data.user.name).toBe("Alice Developer");
    expect(body.data.user.id).toBeDefined();

    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toBeDefined();
    expect(setCookie).toContain("jobops.session=");
  });

  it("prevents duplicate registration with the same email", async () => {
    await fetch(`${context.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "duplicate@example.com",
        password: "password123",
      }),
    });

    const res = await fetch(`${context.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "duplicate@example.com",
        password: "password456",
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.message).toContain("already exists");
  });

  it("authenticates an existing user and allows /api/auth/me", async () => {
    // 1. Register
    await fetch(`${context.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "bob@example.com",
        password: "securepassword",
        name: "Bob Builder",
      }),
    });

    // 2. Login
    const loginRes = await fetch(`${context.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "bob@example.com",
        password: "securepassword",
      }),
    });

    expect(loginRes.status).toBe(200);
    const loginBody = await loginRes.json();
    expect(loginBody.ok).toBe(true);
    expect(loginBody.data.user.email).toBe("bob@example.com");

    const cookieHeader = loginRes.headers.get("set-cookie");
    expect(cookieHeader).toBeDefined();
    const cookie = cookieHeader?.split(";")[0] ?? "";

    // 3. /api/auth/me with session cookie
    const meRes = await fetch(`${context.baseUrl}/api/auth/me`, {
      headers: { Cookie: cookie },
    });
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json();
    expect(meBody.ok).toBe(true);
    expect(meBody.data.user.email).toBe("bob@example.com");
    expect(meBody.data.user.name).toBe("Bob Builder");
  });

  it("handles forgot password and reset password workflow end-to-end", async () => {
    // 1. Register user
    await fetch(`${context.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "resetme@example.com",
        password: "oldpassword123",
      }),
    });

    // 2. Request forgot password
    const forgotRes = await fetch(
      `${context.baseUrl}/api/auth/forgot-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "resetme@example.com" }),
      },
    );
    expect(forgotRes.status).toBe(200);
    const forgotBody = await forgotRes.json();
    expect(forgotBody.ok).toBe(true);
    const devToken = forgotBody.data.devToken;
    expect(devToken).toBeDefined();

    // 3. Verify reset token
    const verifyRes = await fetch(
      `${context.baseUrl}/api/auth/verify-reset-token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: devToken }),
      },
    );
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.ok).toBe(true);
    expect(verifyBody.data.valid).toBe(true);
    expect(verifyBody.data.email).toBe("resetme@example.com");

    // 4. Reset password
    const resetRes = await fetch(`${context.baseUrl}/api/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: devToken,
        newPassword: "newpassword123",
      }),
    });
    expect(resetRes.status).toBe(200);
    const resetBody = await resetRes.json();
    expect(resetBody.ok).toBe(true);

    // 5. Old password no longer works
    const oldLoginRes = await fetch(`${context.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "resetme@example.com",
        password: "oldpassword123",
      }),
    });
    expect(oldLoginRes.status).toBe(401);

    // 6. New password works
    const newLoginRes = await fetch(`${context.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "resetme@example.com",
        password: "newpassword123",
      }),
    });
    expect(newLoginRes.status).toBe(200);

    // 7. Token cannot be reused
    const reusedResetRes = await fetch(
      `${context.baseUrl}/api/auth/reset-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: devToken,
          newPassword: "anotherpassword123",
        }),
      },
    );
    expect(reusedResetRes.status).toBe(400);
  });

  it("updates user profile and changes password for authenticated user", async () => {
    // 1. Register
    const regRes = await fetch(`${context.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "profile@example.com",
        password: "password123",
        name: "Initial Name",
      }),
    });
    const cookie = regRes.headers.get("set-cookie")?.split(";")[0] ?? "";

    // 2. Update profile
    const updateRes = await fetch(`${context.baseUrl}/api/auth/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        name: "Updated Name",
      }),
    });
    expect(updateRes.status).toBe(200);
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);
    expect(updateBody.data.user.name).toBe("Updated Name");

    // 3. Change password
    const changePassRes = await fetch(
      `${context.baseUrl}/api/auth/change-password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookie,
        },
        body: JSON.stringify({
          currentPassword: "password123",
          newPassword: "changedpassword456",
        }),
      },
    );
    expect(changePassRes.status).toBe(200);
    const changePassBody = await changePassRes.json();
    expect(changePassBody.ok).toBe(true);

    // 4. Verify login with changed password
    const loginRes = await fetch(`${context.baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "profile@example.com",
        password: "changedpassword456",
      }),
    });
    expect(loginRes.status).toBe(200);
  });

  it("enforces multi-user isolation across user accounts", async () => {
    // 1. User Alpha registers
    const alphaReg = await fetch(`${context.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "alpha@example.com",
        password: "password123",
        name: "Alpha User",
      }),
    });
    const alphaCookie = alphaReg.headers.get("set-cookie")?.split(";")[0] ?? "";

    // 2. User Beta registers
    const betaReg = await fetch(`${context.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "beta@example.com",
        password: "password123",
        name: "Beta User",
      }),
    });
    const betaCookie = betaReg.headers.get("set-cookie")?.split(";")[0] ?? "";

    // 3. User Alpha creates a manual job
    const createJobRes = await fetch(
      `${context.baseUrl}/api/manual-jobs/import`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: alphaCookie,
        },
        body: JSON.stringify({
          job: {
            title: "Alpha Software Engineer",
            employer: "Alpha Corp",
            jobUrl: "https://alpha.example.com/job/1",
            jobDescription: "Developing great TypeScript applications",
          },
        }),
      },
    );
    expect(createJobRes.status).toBe(200);

    // 4. User Alpha checks their stats & jobs
    const alphaStatsRes = await fetch(`${context.baseUrl}/api/auth/stats`, {
      headers: { Cookie: alphaCookie },
    });
    const alphaStats = await alphaStatsRes.json();
    expect(alphaStats.data.stats.totalJobs).toBe(1);

    const alphaJobsRes = await fetch(`${context.baseUrl}/api/jobs`, {
      headers: { Cookie: alphaCookie },
    });
    const alphaJobs = await alphaJobsRes.json();
    expect(alphaJobs.data.jobs.length).toBe(1);
    expect(alphaJobs.data.jobs[0].title).toBe("Alpha Software Engineer");

    // 5. User Beta checks their stats & jobs -> should be 0 (isolated!)
    const betaStatsRes = await fetch(`${context.baseUrl}/api/auth/stats`, {
      headers: { Cookie: betaCookie },
    });
    const betaStats = await betaStatsRes.json();
    expect(betaStats.data.stats.totalJobs).toBe(0);

    const betaJobsRes = await fetch(`${context.baseUrl}/api/jobs`, {
      headers: { Cookie: betaCookie },
    });
    const betaJobs = await betaJobsRes.json();
    expect(betaJobs.data.jobs.length).toBe(0);
  });
});
