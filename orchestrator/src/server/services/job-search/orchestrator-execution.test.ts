/**
 * End-to-end execution test for executeJobSearch (ADR-002).
 *
 * Real: planner, scheduler, accumulator, filter, dedup, repository (temp DB).
 * Mocked: extractor registry, query parser, ranking, settings, email.
 *
 * Proves: each manifest is invoked exactly once with exact selected sources,
 * the search completes with persisted results, and email isolation holds.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  CreateJobInput,
  ExtractorManifest,
  ParsedSearchSpec,
} from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spec: ParsedSearchSpec = {
  roles: ["Data Engineer"],
  skills: [],
  location: { country: "Canada", cities: [] },
  workMode: "remote",
  employmentType: null,
  experience: { minYears: null, maxYears: null },
  salary: { min: null, max: null, currency: null },
  postedWithin: { value: null, unit: null },
  excludeTerms: [],
  seniority: null,
  industry: null,
  interpretation: "Data Engineer in Canada, remote",
  confidence: "high",
  explicitConstraints: ["roles", "location", "workMode"],
  inferredPreferences: [],
};

const job1: CreateJobInput = {
  source: "indeed" as never,
  title: "Data Engineer",
  employer: "Corp A",
  jobUrl: "https://example.com/1",
  location: "Toronto, Canada",
  isRemote: true,
};
const job2: CreateJobInput = {
  source: "linkedin" as never,
  title: "Data Engineer",
  employer: "Corp B",
  jobUrl: "https://example.com/2",
  location: "Vancouver, Canada",
  isRemote: true,
};
const job3: CreateJobInput = {
  source: "remotive" as never,
  title: "Data Engineer",
  employer: "Corp C",
  jobUrl: "https://example.com/3",
  location: "Remote, Canada",
  isRemote: true,
};

const jobSpyRun = vi.fn(async (_ctx: unknown) => ({
  success: true,
  jobs: [job1, job2],
}));
const remotiveRun = vi.fn(async (_ctx: unknown) => ({
  success: true,
  jobs: [job3],
}));

const jobSpyManifest = {
  id: "jobspy",
  displayName: "JobSpy",
  providesSources: ["indeed", "linkedin"],
  run: jobSpyRun,
} as unknown as ExtractorManifest;
const remotiveManifest = {
  id: "remotive",
  displayName: "Remotive",
  providesSources: ["remotive"],
  run: remotiveRun,
} as unknown as ExtractorManifest;

const fakeRegistry = {
  manifests: new Map([
    ["jobspy", jobSpyManifest],
    ["remotive", remotiveManifest],
  ]),
  manifestBySource: new Map([
    ["indeed", jobSpyManifest],
    ["linkedin", jobSpyManifest],
    ["remotive", remotiveManifest],
  ]),
  availableSources: ["indeed", "linkedin", "remotive"],
};

vi.mock("@server/extractors/registry", () => ({
  getExtractorRegistry: vi.fn(async () => fakeRegistry),
}));

vi.mock("@server/repositories/settings", () => ({
  getAllSettings: vi.fn(async () => ({})),
  getSetting: vi.fn(async () => null),
}));

vi.mock("./meta-search", () => ({
  getAvailableMetaAdapters: vi.fn(async () => []),
  runMetaSearchAdapter: vi.fn(),
}));

vi.mock("../email", () => ({
  sendSearchResultsEmail: vi.fn(async () => ({
    success: false,
    error: "SMTP not configured",
  })),
}));

vi.mock("./query-parser", () => ({
  parseSearchQuery: vi.fn(async () => spec),
  computeSearchHash: vi.fn(() => "spec-hash-e2e"),
  computeAdmissionHash: vi.fn(() => "admission-hash-e2e"),
  JOB_SEARCH_PARSER_VERSION: "1",
}));

vi.mock("./ranking", () => ({
  rankJobs: vi.fn(
    async (
      filterResults: Array<{
        job: CreateJobInput;
        passed: boolean;
        verifiedConstraints: string[];
        unverifiedConstraints: string[];
      }>,
    ) =>
      filterResults
        .filter((r) => r.passed)
        .map((r) => ({
          job: r.job,
          sources: [],
          relevanceScore: 75,
          matchExplanation: "test match",
          verifiedConstraints: r.verifiedConstraints,
          unverifiedConstraints: r.unverifiedConstraints,
          filteredOut: false,
          filterReason: null,
        })),
  ),
}));

describe.sequential("executeJobSearch end-to-end", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";
  let closeDb: (() => void) | null = null;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    jobSpyRun.mockClear();
    remotiveRun.mockClear();

    tempDir = await mkdtemp(join(tmpdir(), "job-ops-search-e2e-"));
    process.env = { ...originalEnv, DATA_DIR: tempDir, NODE_ENV: "test" };
    delete process.env.SMTP_HOST;

    await import("@server/db/migrate");
    const dbModule = await import("@server/db");
    closeDb = dbModule.closeDb;
  });

  afterEach(async () => {
    closeDb?.();
    closeDb = null;
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
    process.env = { ...originalEnv };
  });

  it("invokes each manifest exactly once with exact selected sources and completes the search", async () => {
    const repo = await import("@server/repositories/job-search");
    const created = await repo.createJobSearch({
      admissionHash: "e2e-admission",
      originalQuery: "Data Engineer in Canada, remote",
      parserVersion: "1",
      sourcePlanVersion: "1",
    });
    expect(created).not.toBeNull();
    if (!created) return;

    const { executeJobSearch } = await import("./orchestrator");
    await executeJobSearch(created.id, "Data Engineer in Canada, remote");

    const search = await repo.getJobSearch(created.id);
    expect(search?.status).toBe("completed");
    expect(search?.phase).toBe("completed");
    expect(search?.specHash).toBe("spec-hash-e2e");
    expect(search?.results?.totalDiscovered).toBe(3);
    expect(search?.results?.totalAfterFilter).toBe(3);
    expect(search?.results?.jobs).toHaveLength(3);

    // Each manifest invoked exactly once with exact selected sources.
    expect(jobSpyRun).toHaveBeenCalledTimes(1);
    expect(remotiveRun).toHaveBeenCalledTimes(1);

    const jobSpyCall = jobSpyRun.mock.calls[0]?.[0] as unknown as {
      selectedSources: string[];
    };
    const remotiveCall = remotiveRun.mock.calls[0]?.[0] as unknown as {
      selectedSources: string[];
    };
    expect(jobSpyCall?.selectedSources).toEqual(["indeed", "linkedin"]);
    expect(remotiveCall?.selectedSources).toEqual(["remotive"]);

    // Source statuses include both manifests.
    const sources = search?.results?.sources ?? [];
    expect(sources.some((s) => s.source === "jobspy")).toBe(true);
    expect(sources.some((s) => s.source === "remotive")).toBe(true);

    // Email is skipped (SMTP not configured), search stays completed.
    expect(search?.emailStatus).toBe("skipped");
    expect(search?.results?.jobs[0].sources.length).toBeGreaterThanOrEqual(1);
  });

  it("completes with a degraded result when one manifest fails", async () => {
    (
      jobSpyRun as unknown as { mockResolvedValueOnce: (v: unknown) => void }
    ).mockResolvedValueOnce({
      success: false,
      jobs: [],
      error: "upstream down",
    });

    const repo = await import("@server/repositories/job-search");
    const created = await repo.createJobSearch({
      admissionHash: "e2e-fail",
      originalQuery: "Data Engineer in Canada, remote",
      parserVersion: "1",
      sourcePlanVersion: "1",
    });
    expect(created).not.toBeNull();
    if (!created) return;

    const { executeJobSearch } = await import("./orchestrator");
    await executeJobSearch(created.id, "Data Engineer in Canada, remote");

    const search = await repo.getJobSearch(created.id);
    expect(search?.status).toBe("completed");
    expect(search?.results?.totalDiscovered).toBe(1);
    const jobspyStatus = search?.results?.sources.find(
      (s) => s.source === "jobspy",
    );
    expect(jobspyStatus?.status).toBe("failed");
    const remotiveStatus = search?.results?.sources.find(
      (s) => s.source === "remotive",
    );
    expect(remotiveStatus?.status).toBe("succeeded");
  });
});
