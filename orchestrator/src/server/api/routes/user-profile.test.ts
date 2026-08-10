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
    "fake pdf content",
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
  certifications: [],
  languages: [],
  links: [],
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

  it("uploads a PDF and returns the profile + base resume", async () => {
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

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.profile.fullName).toBe("Jane Doe");
    expect(body.data.baseResume.basics.name).toBe("Jane Doe");
    expect(mockProcessResumeUpload).toHaveBeenCalledTimes(1);
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
});
