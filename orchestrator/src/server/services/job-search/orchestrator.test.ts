/**
 * Tests for the job search orchestrator's email delivery isolation.
 *
 * Core guarantee: email delivery is best-effort. Whether SMTP is
 * unconfigured, the provider fails, or even an unexpected error is thrown,
 * the search stays "completed" with results intact — the UI always shows
 * results regardless of email infrastructure.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobSearchResults } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/services/email", () => ({
  sendSearchResultsEmail: vi.fn(),
}));

const sampleResults: JobSearchResults = {
  totalDiscovered: 10,
  totalAfterFilter: 3,
  duplicatesRemoved: 2,
  highlyRelevant: 1,
  incompleteInfo: 1,
  jobs: [
    {
      job: {
        source: "adzuna",
        title: "Data Engineer",
        employer: "Tech Corp",
        jobUrl: "https://example.com/1",
        location: "Toronto, Canada",
        isRemote: true,
      },
      sources: ["adzuna"],
      relevanceScore: 90,
      matchExplanation: "matches",
      verifiedConstraints: ["roles"],
      unverifiedConstraints: [],
      filteredOut: false,
      filterReason: null,
    },
  ],
  sources: [],
  freshness: {
    requested: null,
    effectiveStart: null,
    effectiveEnd: null,
    removedByFreshness: 0,
  },
};

describe.sequential("job search email isolation", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";
  let closeDb: (() => void) | null = null;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-search-email-test-"));
    process.env = {
      ...originalEnv,
      DATA_DIR: tempDir,
      NODE_ENV: "test",
    };

    await import("@server/db/migrate");
    const dbModule = await import("@server/db");
    closeDb = dbModule.closeDb;
  });

  afterEach(async () => {
    closeDb?.();
    closeDb = null;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    process.env = { ...originalEnv };
    vi.clearAllMocks();
  });

  async function createCompletedSearch(
    repo: typeof import("@server/repositories/job-search"),
    hash: string,
  ): Promise<string> {
    const created = await repo.createJobSearch({
      admissionHash: hash,
      originalQuery: "Data Engineer in Canada",
      parserVersion: "1",
      sourcePlanVersion: "1",
    });
    expect(created).not.toBeNull();
    if (!created) throw new Error("createJobSearch returned null");

    await repo.updateJobSearch(created.id, {
      status: "completed",
      phase: "completed",
      results: sampleResults,
      searchCompletedAt: "2026-08-09T00:00:00.000Z",
    });
    return created.id;
  }

  it("keeps the search completed and skips email when SMTP is not configured", async () => {
    const repo = await import("@server/repositories/job-search");
    const emailService = await import("@server/services/email");
    vi.mocked(emailService.sendSearchResultsEmail).mockResolvedValue({
      success: false,
      error: "SMTP not configured",
    });

    const searchId = await createCompletedSearch(repo, "hash-a");
    const { attemptEmailDelivery } = await import("./orchestrator");

    await attemptEmailDelivery(searchId);

    const search = await repo.getJobSearch(searchId);
    expect(search?.status).toBe("completed");
    expect(search?.emailStatus).toBe("skipped");
    expect(search?.emailError).toBe("SMTP not configured");
    expect(search?.results?.totalAfterFilter).toBe(3);
    expect(search?.results?.jobs).toHaveLength(1);
  });

  it("keeps the search completed when the email provider fails", async () => {
    const repo = await import("@server/repositories/job-search");
    const emailService = await import("@server/services/email");
    vi.mocked(emailService.sendSearchResultsEmail).mockResolvedValue({
      success: false,
      error: "Connection refused",
    });

    const searchId = await createCompletedSearch(repo, "hash-b");
    const { attemptEmailDelivery } = await import("./orchestrator");

    await attemptEmailDelivery(searchId);

    const search = await repo.getJobSearch(searchId);
    expect(search?.status).toBe("completed");
    expect(search?.emailStatus).toBe("failed");
    expect(search?.emailError).toBe("Connection refused");
    expect(search?.results?.jobs).toHaveLength(1);
  });

  it("keeps the search completed even when the email service throws unexpectedly", async () => {
    const repo = await import("@server/repositories/job-search");
    const emailService = await import("@server/services/email");
    vi.mocked(emailService.sendSearchResultsEmail).mockRejectedValue(
      new Error("render bug"),
    );

    const searchId = await createCompletedSearch(repo, "hash-c");
    const { attemptEmailDelivery } = await import("./orchestrator");

    await expect(attemptEmailDelivery(searchId)).resolves.toBeUndefined();

    const search = await repo.getJobSearch(searchId);
    expect(search?.status).toBe("completed");
    expect(search?.emailStatus).toBe("failed");
    expect(search?.emailError).toBe("render bug");
    expect(search?.results?.totalDiscovered).toBe(10);
    expect(search?.results?.jobs[0].job.title).toBe("Data Engineer");
  });

  it("marks the search completed and sends the email when SMTP works", async () => {
    const repo = await import("@server/repositories/job-search");
    const emailService = await import("@server/services/email");
    vi.mocked(emailService.sendSearchResultsEmail).mockResolvedValue({
      success: true,
    });

    const searchId = await createCompletedSearch(repo, "hash-d");
    const { attemptEmailDelivery } = await import("./orchestrator");

    await attemptEmailDelivery(searchId);

    const search = await repo.getJobSearch(searchId);
    expect(search?.status).toBe("completed");
    expect(search?.emailStatus).toBe("sent");
    expect(search?.emailSentAt).not.toBeNull();
  });
});
