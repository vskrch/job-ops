/**
 * Tests for the search accumulator (ADR-002).
 *
 * Core guarantees: final results are invariant to source completion order,
 * provisional snapshots are deterministic filtered candidates (never LLM
 * scored), and mutations are serialized through one owner.
 */

import type {
  CreateJobInput,
  ParsedSearchSpec,
  SearchManifestResult,
} from "@shared/types";
import { describe, expect, it } from "vitest";
import { SearchAccumulator } from "./accumulator";

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
  interpretation: "",
  confidence: "high",
  explicitConstraints: [],
  inferredPreferences: [],
};

function makeJob(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    source: "remotive",
    title: "Data Engineer",
    employer: "Tech Corp",
    jobUrl: `https://example.com/${Math.random().toString(36).slice(2)}`,
    location: "Toronto, Canada",
    isRemote: true,
    ...overrides,
  };
}

function makeResult(
  manifestId: string,
  jobs: CreateJobInput[],
): SearchManifestResult {
  return {
    manifestId,
    displayName: manifestId,
    selectedSources: [manifestId],
    jobs,
    status: "succeeded",
    error: null,
    durationMs: 1,
  };
}

describe("SearchAccumulator", () => {
  it("produces the same final filtered set regardless of completion order", async () => {
    const jobsA = [
      makeJob({ source: "remotive", jobUrl: "https://example.com/1" }),
      makeJob({ source: "remotive", jobUrl: "https://example.com/2" }),
    ];
    const jobsB = [
      makeJob({ source: "adzuna", jobUrl: "https://example.com/3" }),
      makeJob({ source: "adzuna", jobUrl: "https://example.com/4" }),
    ];

    const acc1 = new SearchAccumulator(spec);
    await acc1.enqueue(() => acc1.ingest(makeResult("remotive", jobsA)));
    await acc1.enqueue(() => acc1.ingest(makeResult("adzuna", jobsB)));
    const final1 = acc1.finalFiltered();
    const urls1 = final1.filterResults
      .filter((r) => r.passed)
      .map((r) => r.job.jobUrl)
      .sort();

    const acc2 = new SearchAccumulator(spec);
    await acc2.enqueue(() => acc2.ingest(makeResult("adzuna", jobsB)));
    await acc2.enqueue(() => acc2.ingest(makeResult("remotive", jobsA)));
    const final2 = acc2.finalFiltered();
    const urls2 = final2.filterResults
      .filter((r) => r.passed)
      .map((r) => r.job.jobUrl)
      .sort();

    expect(urls1).toEqual(urls2);
    expect(final1.deduped.length).toBe(final2.deduped.length);
  });

  it("merges duplicate jobs across manifests and keeps richer records", async () => {
    const sparse = makeJob({
      source: "remotive",
      jobUrl: "https://example.com/dup",
    });
    const rich = makeJob({
      source: "adzuna",
      jobUrl: "https://example.com/dup",
      salary: "CAD 120k",
      jobDescription: "Full description",
    });

    const acc = new SearchAccumulator(spec);
    await acc.enqueue(() => acc.ingest(makeResult("remotive", [sparse])));
    await acc.enqueue(() => acc.ingest(makeResult("adzuna", [rich])));

    const { deduped } = acc.finalFiltered();
    expect(deduped).toHaveLength(1);
    expect(deduped[0].sources.sort()).toEqual(["adzuna", "remotive"]);
    expect(deduped[0].salary).toBe("CAD 120k");
  });

  it("emits provisional snapshots with deterministic counts and no LLM scores", async () => {
    const acc = new SearchAccumulator(spec);
    await acc.enqueue(() => acc.ingest(makeResult("remotive", [makeJob()])));
    const snapshot = acc.snapshot();

    expect(snapshot.discovered).toBe(1);
    expect(snapshot.afterFilter).toBe(1);
    expect(snapshot.duplicatesRemoved).toBe(0);
    expect(snapshot.resultVersion).toBe(1);
    expect(snapshot.items[0].relevanceScore).toBe(0);
    expect(snapshot.items[0].matchExplanation).toContain("Provisional");
  });

  it("increments resultVersion per snapshot and freezes evaluation time", async () => {
    const acc = new SearchAccumulator(spec);
    const evalTime = acc.evaluationTimeValue;
    await acc.enqueue(() => acc.ingest(makeResult("remotive", [makeJob()])));
    await acc.enqueue(() => {
      acc.snapshot();
    });
    await acc.enqueue(() => {
      acc.snapshot();
    });

    expect(acc.resultVersion).toBe(2);
    expect(acc.evaluationTimeValue).toBe(evalTime);
  });

  it("exposes the total discovered count before dedup", async () => {
    const acc = new SearchAccumulator(spec);
    await acc.enqueue(() =>
      acc.ingest(
        makeResult("remotive", [
          makeJob({ jobUrl: "https://example.com/a" }),
          makeJob({ jobUrl: "https://example.com/a" }),
        ]),
      ),
    );
    expect(acc.totalDiscovered()).toBe(2);
  });
});
