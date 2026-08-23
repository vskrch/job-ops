/**
 * Cross-user isolation regression tests.
 *
 * Each fixed surface is exercised over HTTP with two registered users:
 * user B must get 404/403/empty for user A's resources. These tests exist
 * because the original multi-tenancy suite covered only the repositories
 * that were already scoped — every regression caught here was a live bug.
 */

import { mkdir, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, stopServer } from "./test-utils";

type StartedServer = {
  server: Server;
  baseUrl: string;
  closeDb: () => void;
  tempDir: string;
};

async function registerUser(
  baseUrl: string,
  email: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ cookie: string; userId: string }> {
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...extraHeaders },
    body: JSON.stringify({ email, password: "password-123", name: email }),
  });
  expect(res.ok).toBe(true);
  const body = await res.json();
  const setCookie = res.headers.get("set-cookie");
  expect(setCookie).toBeTruthy();
  return {
    cookie: setCookie?.split(";")[0] ?? "",
    userId: body.data.user.id as string,
  };
}

describe.sequential("cross-user isolation (routes)", () => {
  let base: StartedServer;
  let cookieA = "";
  let cookieB = "";
  let userIdA = "";
  let userIdB = "";
  let jobAId = "";
  let jobBId = "";

  beforeEach(async () => {
    base = await startServer();
    const userA = await registerUser(base.baseUrl, "user-a@test.local");
    const userB = await registerUser(base.baseUrl, "user-b@test.local");
    cookieA = userA.cookie;
    cookieB = userB.cookie;
    userIdA = userA.userId;
    userIdB = userB.userId;

    const { runWithRequestContext } = await import("@infra/request-context");
    const jobsRepo = await import("@server/repositories/jobs");
    const jobA = await runWithRequestContext({ userId: userIdA }, () =>
      jobsRepo.createJobs({
        source: "hiringcafe",
        title: "Job A",
        employer: "Isolation Corp",
        jobUrl: "https://example.com/job/a",
      }),
    );
    const jobB = await runWithRequestContext({ userId: userIdB }, () =>
      jobsRepo.createJobs({
        source: "hiringcafe",
        title: "Job B",
        employer: "Isolation Corp",
        jobUrl: "https://example.com/job/b",
      }),
    );
    jobAId = jobA.id;
    jobBId = jobB.id;
  });

  afterEach(async () => {
    await stopServer({
      server: base.server,
      closeDb: base.closeDb,
      tempDir: base.tempDir,
    });
  });

  it("hides another user's stage events, tasks, and stage transitions", async () => {
    const { runWithRequestContext } = await import("@infra/request-context");
    const { transitionStage } = await import(
      "@server/services/applicationTracking"
    );
    runWithRequestContext({ userId: userIdA }, () =>
      transitionStage(jobAId, "applied"),
    );

    const asOwner = await fetch(`${base.baseUrl}/api/jobs/${jobAId}/events`, {
      headers: { Cookie: cookieA },
    });
    expect(asOwner.status).toBe(200);
    expect((await asOwner.json()).data.length).toBeGreaterThan(0);

    const asIntruder = await fetch(
      `${base.baseUrl}/api/jobs/${jobAId}/events`,
      {
        headers: { Cookie: cookieB },
      },
    );
    expect(asIntruder.status).toBe(404);

    const tasksIntruder = await fetch(
      `${base.baseUrl}/api/jobs/${jobAId}/tasks`,
      { headers: { Cookie: cookieB } },
    );
    expect(tasksIntruder.status).toBe(404);

    const stageIntruder = await fetch(
      `${base.baseUrl}/api/jobs/${jobAId}/stages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieB },
        body: JSON.stringify({ toStage: "offer" }),
      },
    );
    expect(stageIntruder.status).toBe(404);
  });

  it("rejects cross-user stage-event update and delete by id", async () => {
    const { runWithRequestContext } = await import("@infra/request-context");
    const { transitionStage } = await import(
      "@server/services/applicationTracking"
    );
    const event = runWithRequestContext({ userId: userIdA }, () =>
      transitionStage(jobAId, "applied"),
    );

    // B cannot touch A's event even with the real event id in the URL.
    const patch = await fetch(
      `${base.baseUrl}/api/jobs/${jobAId}/events/${event.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieB },
        body: JSON.stringify({ toStage: "offer" }),
      },
    );
    expect(patch.status).toBe(404);

    // B cannot use their own job id to reach A's event id either.
    const patchViaOwnJob = await fetch(
      `${base.baseUrl}/api/jobs/${jobBId}/events/${event.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieB },
        body: JSON.stringify({ toStage: "offer" }),
      },
    );
    expect(patchViaOwnJob.status).toBe(404);

    const remove = await fetch(
      `${base.baseUrl}/api/jobs/${jobAId}/events/${event.id}`,
      { method: "DELETE", headers: { Cookie: cookieB } },
    );
    expect(remove.status).toBe(404);

    // A can still update their own event.
    const patchOwner = await fetch(
      `${base.baseUrl}/api/jobs/${jobAId}/events/${event.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: cookieA },
        body: JSON.stringify({ toStage: "recruiter_screen" }),
      },
    );
    expect(patchOwner.status).toBe(200);
  });

  it("blocks ghostwriter chat access to another user's job", async () => {
    const asOwner = await fetch(
      `${base.baseUrl}/api/jobs/${jobAId}/chat/messages`,
      { headers: { Cookie: cookieA } },
    );
    expect(asOwner.status).toBe(200);

    const asIntruder = await fetch(
      `${base.baseUrl}/api/jobs/${jobAId}/chat/messages`,
      { headers: { Cookie: cookieB } },
    );
    expect(asIntruder.status).toBe(404);

    const postIntruder = await fetch(
      `${base.baseUrl}/api/jobs/${jobAId}/chat/messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookieB },
        body: JSON.stringify({ content: "leak please" }),
      },
    );
    expect(postIntruder.status).toBe(404);
  });

  it("scopes tracer analytics to the requesting user", async () => {
    const { runWithRequestContext } = await import("@infra/request-context");
    const tracerRepo = await import("@server/repositories/tracer-links");

    await runWithRequestContext({ userId: userIdA }, async () => {
      const link = await tracerRepo.getOrCreateTracerLink({
        jobId: jobAId,
        sourcePath: "/resume",
        sourceLabel: "Resume",
        destinationUrl: "https://example.com/dest",
        destinationUrlHash: "hash-a",
        slugPrefix: "alice",
      });
      await tracerRepo.insertTracerClickEvent({
        tracerLinkId: link.id,
        clickedAt: Math.floor(Date.now() / 1000),
        requestId: null,
        isLikelyBot: false,
        deviceType: "desktop",
        uaFamily: "chrome",
        osFamily: "macos",
        referrerHost: null,
        ipHash: null,
        uniqueFingerprintHash: "fp-1",
      });
    });

    const asOwner = await fetch(`${base.baseUrl}/api/tracer-links/analytics`, {
      headers: { Cookie: cookieA },
    });
    expect(asOwner.status).toBe(200);
    const ownerBody = await asOwner.json();
    expect(ownerBody.data.totals.clicks).toBe(1);

    const asIntruder = await fetch(
      `${base.baseUrl}/api/tracer-links/analytics`,
      { headers: { Cookie: cookieB } },
    );
    expect(asIntruder.status).toBe(200);
    const intruderBody = await asIntruder.json();
    expect(intruderBody.data.totals.clicks).toBe(0);
    expect(intruderBody.data.topJobs).toHaveLength(0);
  });

  it("blocks design-resume asset content fetch across users", async () => {
    const { runWithRequestContext } = await import("@infra/request-context");
    const designResumeRepo = await import("@server/repositories/design-resume");

    const assetId = await runWithRequestContext(
      { userId: userIdA },
      async () => {
        await designResumeRepo.upsertDesignResumeDocument({
          id: "doc-a",
          title: "A's resume",
          resumeJson: {},
          revision: 1,
          sourceResumeId: null,
          sourceMode: null,
          importedAt: null,
          updatedAt: new Date().toISOString(),
        });
        const storagePath = join(base.tempDir, "asset-a.png");
        await writeFile(storagePath, "fake-image-bytes");
        const asset = await designResumeRepo.insertDesignResumeAsset({
          id: "asset-a",
          documentId: "doc-a",
          kind: "picture",
          originalName: "photo.png",
          mimeType: "image/png",
          byteSize: 16,
          storagePath,
          updatedAt: new Date().toISOString(),
        });
        return asset?.id ?? "asset-a";
      },
    );

    const asOwner = await fetch(
      `${base.baseUrl}/api/design-resume/assets/${assetId}/content`,
      { headers: { Cookie: cookieA } },
    );
    expect(asOwner.status).toBe(200);

    const asIntruder = await fetch(
      `${base.baseUrl}/api/design-resume/assets/${assetId}/content`,
      { headers: { Cookie: cookieB } },
    );
    expect(asIntruder.status).toBe(404);
  });

  it("serves job PDFs only to the owning user and rejects traversal", async () => {
    const pdfDir = join(base.tempDir, "pdfs");
    await mkdir(pdfDir, { recursive: true });
    await writeFile(join(pdfDir, `resume_${jobAId}.pdf`), "%PDF-fake");

    const asOwner = await fetch(`${base.baseUrl}/pdfs/resume_${jobAId}.pdf`, {
      headers: { Cookie: cookieA },
    });
    expect(asOwner.status).toBe(200);

    const asIntruder = await fetch(
      `${base.baseUrl}/pdfs/resume_${jobAId}.pdf`,
      { headers: { Cookie: cookieB } },
    );
    expect(asIntruder.status).toBe(404);

    const anonymous = await fetch(`${base.baseUrl}/pdfs/resume_${jobAId}.pdf`);
    expect(anonymous.status).toBe(404);

    const traversal = await fetch(`${base.baseUrl}/pdfs/..%2Fjobs.db`);
    expect(traversal.status).toBe(404);
  });

  it("forbids whole-database clear once more than one account exists", async () => {
    const res = await fetch(`${base.baseUrl}/api/database`, {
      method: "DELETE",
      headers: { Cookie: cookieA },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("FORBIDDEN");

    // Data must still be there.
    const jobs = await fetch(`${base.baseUrl}/api/jobs`, {
      headers: { Cookie: cookieA },
    });
    expect(jobs.status).toBe(200);
    expect((await jobs.json()).data.jobs.length).toBeGreaterThan(0);
  });
});

describe.sequential("AUTH_MODE=session edge rejection", () => {
  let base: StartedServer;

  beforeEach(async () => {
    base = await startServer({ env: { AUTH_MODE: "session" } });
  });

  afterEach(async () => {
    await stopServer({
      server: base.server,
      closeDb: base.closeDb,
      tempDir: base.tempDir,
    });
  });

  it("rejects anonymous API requests with 401 instead of default-user", async () => {
    const anon = await fetch(`${base.baseUrl}/api/jobs`);
    expect(anon.status).toBe(401);
    const body = await anon.json();
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");

    // Credential endpoints stay reachable without a session.
    const register = await fetch(`${base.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "session-user@test.local",
        password: "password-123",
      }),
    });
    expect(register.status).toBe(200);
    const cookie = register.headers.get("set-cookie")?.split(";")[0] ?? "";

    // Authenticated requests pass.
    const authed = await fetch(`${base.baseUrl}/api/jobs`, {
      headers: { Cookie: cookie },
    });
    expect(authed.status).toBe(200);

    // Health stays public.
    const health = await fetch(`${base.baseUrl}/health`);
    expect(health.status).toBe(200);
  });

  it("rejects anonymous MCP HTTP/SSE access under session auth", async () => {
    const sse = await fetch(`${base.baseUrl}/mcp`);
    expect(sse.status).toBe(401);

    const message = await fetch(`${base.baseUrl}/mcp/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "ping", id: 1 }),
    });
    expect(message.status).toBe(401);
  });
});

describe.sequential("settings password redaction under Basic Auth", () => {
  let base: StartedServer;

  beforeEach(async () => {
    base = await startServer({
      env: { BASIC_AUTH_USER: "admin", BASIC_AUTH_PASSWORD: "super-secret" },
    });
  });

  afterEach(async () => {
    await stopServer({
      server: base.server,
      closeDb: base.closeDb,
      tempDir: base.tempDir,
    });
  });

  it("never echoes the effective Basic Auth password", async () => {
    const basic = `Basic ${btoa("admin:super-secret")}`;
    const res = await fetch(`${base.baseUrl}/api/settings`, {
      headers: { Authorization: basic },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.basicAuthActive).toBe(true);
    expect(body.data.basicAuthPassword ?? null).toBeNull();
  });
});
