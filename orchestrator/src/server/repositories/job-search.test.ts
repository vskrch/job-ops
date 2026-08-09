/**
 * Tests for the job search repository.
 *
 * Covers the JSON round-trip (results are json-mode columns; manual
 * stringify would double-encode) and the unique query-hash conflict path.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JobSearchResults, ParsedSearchSpec } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("job-search repository", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";
  let closeDb: (() => void) | null = null;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-search-repo-test-"));
    process.env = {
      ...originalEnv,
      DATA_DIR: tempDir,
      NODE_ENV: "test",
    };

    await import("../db/migrate");
    const dbModule = await import("../db");
    closeDb = dbModule.closeDb;
  });

  afterEach(async () => {
    closeDb?.();
    closeDb = null;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    process.env = { ...originalEnv };
  });

  const sampleSpec: ParsedSearchSpec = {
    roles: ["Data Engineer"],
    skills: ["Python"],
    location: { country: "Canada", cities: ["Toronto"] },
    workMode: "remote",
    employmentType: "full_time",
    experience: { minYears: 4, maxYears: 6 },
    salary: { min: null, max: null, currency: null },
    postedWithin: { value: 24, unit: "hours" },
    excludeTerms: [],
    seniority: null,
    industry: null,
    interpretation: "Data Engineer in Canada, remote, 4-6 years, 24h",
    confidence: "high",
    explicitConstraints: ["roles", "location", "workMode"],
    inferredPreferences: [],
  };

  const sampleResults: JobSearchResults = {
    totalDiscovered: 12,
    totalAfterFilter: 4,
    duplicatesRemoved: 3,
    highlyRelevant: 2,
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
        sources: ["adzuna", "remotive"],
        relevanceScore: 92,
        matchExplanation: "Matches all constraints",
        verifiedConstraints: ["roles", "location", "workMode"],
        unverifiedConstraints: [],
        filteredOut: false,
        filterReason: null,
      },
    ],
    sources: [
      {
        source: "adzuna",
        displayName: "Adzuna",
        selectedSources: ["adzuna"],
        status: "succeeded",
        jobsFound: 12,
        error: null,
      },
    ],
    freshness: {
      requested: "last 24 hours",
      effectiveStart: "2026-08-08T00:00:00.000Z",
      effectiveEnd: "2026-08-09T00:00:00.000Z",
      removedByFreshness: 2,
    },
  };

  it("creates and round-trips a search with parsed spec and results as objects (not double-encoded strings)", async () => {
    const repo = await import("./job-search");

    const created = await repo.createJobSearch({
      admissionHash: "admission-hash-1",
      originalQuery: "Data Engineer in Canada",
      parserVersion: "1",
      sourcePlanVersion: "1",
    });

    expect(created).not.toBeNull();
    if (!created) return;

    expect(created.admissionHash).toBe("admission-hash-1");
    expect(created.phase).toBe("queued");

    await repo.updateJobSearch(created.id, {
      status: "completed",
      phase: "completed",
      specHash: "spec-hash-1",
      parsedSpec: sampleSpec,
      results: sampleResults,
      sourcesSucceeded: ["adzuna"],
      sourcesFailed: ["remotive"],
      searchCompletedAt: "2026-08-09T00:00:00.000Z",
    });

    const loaded = await repo.getJobSearch(created.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.status).toBe("completed");
    expect(loaded?.phase).toBe("completed");
    expect(loaded?.specHash).toBe("spec-hash-1");

    // results must be a parsed object, not a JSON string (regression for
    // double-encoding when manually stringify-ing json-mode columns).
    expect(loaded?.results).toBeTypeOf("object");
    expect(Array.isArray(loaded?.results?.jobs)).toBe(true);
    expect(loaded?.results?.totalDiscovered).toBe(12);
    expect(loaded?.results?.jobs[0].job.title).toBe("Data Engineer");
    expect(loaded?.results?.jobs[0].sources).toEqual(["adzuna", "remotive"]);
    expect(loaded?.results?.sources[0].status).toBe("succeeded");

    // parsed spec must round-trip as an object too.
    expect(loaded?.parsedSpec?.roles).toEqual(["Data Engineer"]);
    expect(loaded?.parsedSpec?.workMode).toBe("remote");

    // source arrays must be actual arrays, not strings.
    expect(loaded?.sourcesSucceeded).toEqual(["adzuna"]);
    expect(loaded?.sourcesFailed).toEqual(["remotive"]);
  });

  it("returns null when creating a second search with the same admission hash while the first is running", async () => {
    const repo = await import("./job-search");

    const first = await repo.createJobSearch({
      admissionHash: "duplicate-hash",
      originalQuery: "Same query",
      parserVersion: "1",
      sourcePlanVersion: "1",
    });
    expect(first).not.toBeNull();

    const second = await repo.createJobSearch({
      admissionHash: "duplicate-hash",
      originalQuery: "Same query",
      parserVersion: "1",
      sourcePlanVersion: "1",
    });
    expect(second).toBeNull();

    // The active row must still be retrievable.
    const active = await repo.getRunningSearchByAdmissionHash("duplicate-hash");
    expect(active).not.toBeNull();
    expect(active?.id).toBe(first?.id);
  });

  it("allows a new search after the previous one completed (partial unique index on running rows)", async () => {
    const repo = await import("./job-search");

    const first = await repo.createJobSearch({
      admissionHash: "refresh-hash",
      originalQuery: "Same query",
      parserVersion: "1",
      sourcePlanVersion: "1",
    });
    expect(first).not.toBeNull();
    if (!first) return;

    await repo.updateJobSearch(first.id, {
      status: "completed",
      phase: "completed",
      searchCompletedAt: "2026-08-09T00:00:00.000Z",
    });

    const second = await repo.createJobSearch({
      admissionHash: "refresh-hash",
      originalQuery: "Same query",
      parserVersion: "1",
      sourcePlanVersion: "1",
    });
    expect(second).not.toBeNull();
  });

  it("finds a reusable completed search within the TTL window", async () => {
    const repo = await import("./job-search");

    const created = await repo.createJobSearch({
      admissionHash: "ttl-hash",
      originalQuery: "Same query",
      parserVersion: "1",
      sourcePlanVersion: "1",
    });
    expect(created).not.toBeNull();
    if (!created) return;

    await repo.updateJobSearch(created.id, {
      status: "completed",
      phase: "completed",
      results: sampleResults,
      searchCompletedAt: new Date().toISOString(),
    });

    const reusable = await repo.findReusableSearch("ttl-hash", 60_000);
    expect(reusable).not.toBeNull();
    expect(reusable?.id).toBe(created.id);

    const expired = await repo.findReusableSearch("ttl-hash", 0);
    expect(expired).toBeNull();
  });

  it("lists recent searches with summary counts", async () => {
    const repo = await import("./job-search");

    const created = await repo.createJobSearch({
      admissionHash: "hash-list",
      originalQuery: "Backend Engineer",
      parserVersion: "1",
      sourcePlanVersion: "1",
    });
    expect(created).not.toBeNull();
    if (!created) return;

    await repo.updateJobSearch(created.id, {
      status: "completed",
      phase: "completed",
      results: sampleResults,
      searchCompletedAt: "2026-08-09T00:00:00.000Z",
    });

    const items = await repo.getRecentJobSearches(10);
    expect(items.length).toBeGreaterThanOrEqual(1);
    const item = items.find((i) => i.id === created.id);
    expect(item).toBeDefined();
    expect(item?.totalDiscovered).toBe(12);
    expect(item?.totalAfterFilter).toBe(4);
    expect(item?.status).toBe("completed");
    expect(item?.phase).toBe("completed");
    expect(item?.originalQuery).toBe("Backend Engineer");
  });
});
