import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

vi.mock("@server/services/resume-parser", () => ({
  processResumeUpload: vi.fn(),
  profileToResumeProfile: vi.fn(
    (profile: { fullName: string | null; headline: string | null }) => ({
      basics: { name: profile.fullName, label: profile.headline },
    }),
  ),
}));

import { processResumeUpload } from "@server/services/resume-parser";

const mockProcessResumeUpload = vi.mocked(processResumeUpload);

// Build multipart bodies by hand — jsdom's FormData/Blob break undici's
// fetch in the jsdom test environment, so avoid them entirely.
function multipartBody(
  filename: string,
  contentType: string,
  content = "fake pdf content",
): {
  body: string;
  headers: Record<string, string>;
} {
  const boundary = "----jobops-test-boundary";
  const body = [
    `--${boundary}`,
    `Content-Disposition: form-data; name="file"; filename="${filename}"`,
    `Content-Type: ${contentType}`,
    "",
    content,
    `--${boundary}--`,
    "",
  ].join("\r\n");
  return {
    body,
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
  };
}

const FAKE_PROFILE: import("@shared/types").UserProfile = {
  id: "profile-test-1",
  source: "pdf_upload",
  fullName: "Jane Doe",
  email: "jane@example.com",
  phone: null,
  location: "London, UK",
  headline: "Data Engineer",
  summary: null,
  skills: ["Python", "SQL"],
  experience: [],
  education: [],
  projects: [],
  certifications: [],
  languages: [],
  links: [],
  languageLevels: [],
  dealBreakers: [],
  careerGoals: [],
  behavioralNotes: null,
  starExamples: [],
  fileName: "resume.pdf",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("User profile API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    mockProcessResumeUpload.mockReset();
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("rejects a non-PDF upload with 400", async () => {
    const multipart = multipartBody("notes.txt", "text/plain");
    const res = await fetch(`${baseUrl}/api/user-profile/resume`, {
      method: "POST",
      headers: multipart.headers,
      body: multipart.body,
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(mockProcessResumeUpload).not.toHaveBeenCalled();
  });

  it("rejects an oversized upload with 400 instead of a server error", async () => {
    const big = "x".repeat(10 * 1024 * 1024 + 1);
    const multipart = multipartBody("big.pdf", "application/pdf", big);
    const res = await fetch(`${baseUrl}/api/user-profile/resume`, {
      method: "POST",
      headers: multipart.headers,
      body: multipart.body,
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(mockProcessResumeUpload).not.toHaveBeenCalled();
  });

  it("accepts a PDF upload with 202 and completes via status polling", async () => {
    mockProcessResumeUpload.mockResolvedValue({
      profile: FAKE_PROFILE,
      baseResume: { basics: { name: "Jane Doe", label: "Data Engineer" } },
    });

    const multipart = multipartBody("resume.pdf", "application/pdf");
    const res = await fetch(`${baseUrl}/api/user-profile/resume`, {
      method: "POST",
      headers: multipart.headers,
      body: multipart.body,
    });
    const body = await res.json();

    expect(res.status).toBe(202);
    expect(body.ok).toBe(true);
    expect(typeof body.data.taskId).toBe("string");
    expect(body.data.status).toBe("processing");
    expect(mockProcessResumeUpload).toHaveBeenCalledTimes(1);

    let statusBody: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const statusRes = await fetch(
        `${baseUrl}/api/user-profile/resume/status/${body.data.taskId}`,
      );
      statusBody = await statusRes.json();
      expect(statusRes.status).toBe(200);
      if ((statusBody?.data as { status?: string })?.status === "done") break;
    }

    const data = statusBody?.data as {
      status: string;
      profile?: { fullName?: string };
      baseResume?: { basics?: { name?: string } };
    };
    expect(data.status).toBe("done");
    expect(data.profile?.fullName).toBe("Jane Doe");
    expect(data.baseResume?.basics?.name).toBe("Jane Doe");
  });

  it("reports import failure through the status endpoint", async () => {
    mockProcessResumeUpload.mockRejectedValue(
      new Error("Could not parse the PDF: Invalid PDF structure."),
    );

    const multipart = multipartBody("bad.pdf", "application/pdf");
    const res = await fetch(`${baseUrl}/api/user-profile/resume`, {
      method: "POST",
      headers: multipart.headers,
      body: multipart.body,
    });
    const body = await res.json();
    expect(res.status).toBe(202);

    let statusBody: Record<string, unknown> | null = null;
    for (let attempt = 0; attempt < 50; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const statusRes = await fetch(
        `${baseUrl}/api/user-profile/resume/status/${body.data.taskId}`,
      );
      statusBody = await statusRes.json();
      if ((statusBody?.data as { status?: string })?.status === "failed") break;
    }

    const data = statusBody?.data as {
      status: string;
      error?: { code: string; message: string };
    };
    expect(data.status).toBe("failed");
    // Unknown service errors are genericized (S7 security sweep): only
    // deliberate AppError messages from the parser pass through, and this
    // mock can't fabricate those across the test server's module reset.
    expect(data.error?.message).toBe("Internal server error");
  });

  it("returns 404 for an unknown resume import task", async () => {
    const res = await fetch(
      `${baseUrl}/api/user-profile/resume/status/does-not-exist`,
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when no resume has been uploaded", async () => {
    const res = await fetch(`${baseUrl}/api/user-profile`);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for the base resume when no resume has been uploaded", async () => {
    const res = await fetch(`${baseUrl}/api/user-profile/base-resume`);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when deleting with no uploaded resume", async () => {
    const res = await fetch(`${baseUrl}/api/user-profile`, {
      method: "DELETE",
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when patching preferences with no uploaded profile", async () => {
    const res = await fetch(`${baseUrl}/api/user-profile/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ dealBreakers: ["no on-call"] }),
    });
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects invalid preference payloads with 400", async () => {
    const res = await fetch(`${baseUrl}/api/user-profile/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ languageLevels: [{ level: "fluent" }] }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("updates career preferences and returns the profile", async () => {
    const { upsertUserProfile } = await import(
      "@server/repositories/user-profile"
    );
    await upsertUserProfile({
      profile: {
        fullName: "Jane Doe",
        email: "jane@example.com",
        phone: null,
        location: "London, UK",
        headline: "Data Engineer",
        summary: null,
        skills: ["Python"],
        experience: [],
        education: [],
        projects: [],
        certifications: [],
        languages: ["English"],
        links: [],
      },
      fileName: "resume.pdf",
    });

    const res = await fetch(`${baseUrl}/api/user-profile/preferences`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        languageLevels: [
          { name: "English", level: "native" },
          { name: "German", level: "B1" },
        ],
        dealBreakers: ["no on-call", "no relocation"],
        careerGoals: ["staff engineer track"],
        behavioralNotes: "Thrives in small senior teams.",
        starExamples: [
          {
            id: "star-1",
            title: "Migrated pipeline to streaming",
            useFor: ["ownership", "technical depth"],
            situation: "Batch ETL took 9h nightly.",
            task: "Cut latency under 1h.",
            action: "Rebuilt as Kafka streams.",
            result: "12 min nightly, zero data loss.",
          },
        ],
      }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.profile.languageLevels).toEqual([
      { name: "English", level: "native" },
      { name: "German", level: "B1" },
    ]);
    expect(body.data.profile.dealBreakers).toEqual([
      "no on-call",
      "no relocation",
    ]);
    expect(body.data.profile.careerGoals).toEqual(["staff engineer track"]);
    expect(body.data.profile.behavioralNotes).toBe(
      "Thrives in small senior teams.",
    );
    expect(body.data.profile.starExamples).toHaveLength(1);
    expect(body.data.profile.starExamples[0].useFor).toEqual([
      "ownership",
      "technical depth",
    ]);
    // Resume-derived fields untouched by the preferences patch.
    expect(body.data.profile.fullName).toBe("Jane Doe");
    expect(body.data.profile.languages).toEqual(["English"]);
  });
});
