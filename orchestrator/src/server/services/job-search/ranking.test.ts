/**
 * Tests for the ranking scheduler (ADR-002).
 *
 * Core guarantees: a shared LLM client/model resolved once, bounded
 * concurrency, deterministic candidate caps, per-job fallback on failure,
 * and hard-filter exclusion.
 */

import type { ParsedSearchSpec } from "@shared/types";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmService } from "../llm/service";
import type { FilterResult } from "./filter";
import { rankJobs } from "./ranking";

vi.mock("../llm/service", () => {
  const callJson = vi.fn();
  class MockLlmService {
    callJson = callJson;
  }
  return { LlmService: MockLlmService };
});

const spec: ParsedSearchSpec = {
  roles: ["Data Engineer"],
  skills: ["Python"],
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

function makeFilterResult(
  title: string,
  jobUrl: string,
  verified: string[] = ["roles"],
  passed = true,
): FilterResult {
  return {
    job: {
      source: "remotive",
      title,
      employer: "Tech Corp",
      jobUrl,
      location: "Toronto, Canada",
      isRemote: true,
    },
    passed,
    filterReason: passed ? null : "Failed: location",
    verifiedConstraints: verified,
    unverifiedConstraints: [],
  };
}

function makeLlmCall(score: number) {
  const llm = new LlmService();
  vi.mocked(llm.callJson).mockResolvedValue({
    success: true,
    data: { score, explanation: "matches" },
  });
  return llm;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("rankJobs", () => {
  it("never ranks jobs that failed hard filtering", async () => {
    const llm = makeLlmCall(80);
    const results = await rankJobs(
      [makeFilterResult("Filtered Out", "https://x/1", [], false)],
      spec,
      { llm, model: "test-model" },
    );
    expect(results).toEqual([]);
    expect(llm.callJson).not.toHaveBeenCalled();
  });

  it("sorts results by score descending with deterministic tie order", async () => {
    const llm = new LlmService();
    vi.mocked(llm.callJson)
      .mockResolvedValueOnce({
        success: true,
        data: { score: 50, explanation: "mid" },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { score: 90, explanation: "top" },
      })
      .mockResolvedValueOnce({
        success: true,
        data: { score: 50, explanation: "mid2" },
      });

    const results = await rankJobs(
      [
        makeFilterResult("A", "https://x/2"),
        makeFilterResult("B", "https://x/1"),
        makeFilterResult("C", "https://x/0"),
      ],
      spec,
      { llm, model: "test-model", concurrency: 2 },
    );

    expect(results.map((r) => r.relevanceScore)).toEqual([90, 50, 50]);
    // Ties are ordered by job URL ascending for determinism.
    expect(results.slice(1).map((r) => r.job.jobUrl)).toEqual([
      "https://x/0",
      "https://x/2",
    ]);
  });

  it("caps the number of scored candidates deterministically", async () => {
    const llm = makeLlmCall(70);
    const many = Array.from({ length: 10 }, (_, i) =>
      makeFilterResult(`Job ${i}`, `https://x/${i}`),
    );

    const results = await rankJobs(many, spec, {
      llm,
      model: "test-model",
      maxCandidates: 3,
    });

    expect(results).toHaveLength(3);
    expect(llm.callJson).toHaveBeenCalledTimes(3);
  });

  it("uses deterministic fallback scores when the LLM fails for a job", async () => {
    const llm = new LlmService();
    vi.mocked(llm.callJson)
      .mockResolvedValueOnce({ success: false, error: "rate limited" })
      .mockResolvedValueOnce({
        success: true,
        data: { score: 85, explanation: "good" },
      });

    const results = await rankJobs(
      [
        makeFilterResult("A", "https://x/1", ["roles", "location"]),
        makeFilterResult("B", "https://x/2"),
      ],
      spec,
      { llm, model: "test-model" },
    );

    expect(results).toHaveLength(2);
    const fallback = results.find((r) => r.job.jobUrl === "https://x/1");
    expect(fallback?.relevanceScore).toBeGreaterThanOrEqual(1);
    expect(fallback?.matchExplanation).toContain("fallback");
    const scored = results.find((r) => r.job.jobUrl === "https://x/2");
    expect(scored?.relevanceScore).toBe(85);
  });

  it("falls back deterministically when the LLM throws unexpectedly", async () => {
    const llm = new LlmService();
    vi.mocked(llm.callJson).mockRejectedValue(new Error("upstream exploded"));

    const results = await rankJobs(
      [makeFilterResult("A", "https://x/1", ["roles", "location", "workMode"])],
      spec,
      { llm, model: "test-model" },
    );

    expect(results).toHaveLength(1);
    expect(results[0].relevanceScore).toBe(66);
    expect(results[0].matchExplanation).toContain("fallback");
  });

  it("returns an empty list for an empty candidate set", async () => {
    const results = await rankJobs([], spec, {});
    expect(results).toEqual([]);
  });
});
