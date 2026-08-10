/**
 * Tests for the job search query parser.
 */

import { describe, expect, it } from "vitest";
import {
  computeAdmissionHash,
  computeSearchHash,
  JOB_SEARCH_PARSER_VERSION,
} from "./query-parser";

describe("computeSearchHash", () => {
  it("produces identical hashes for identical queries and specs", () => {
    const query = "Data Engineer in Canada, remote";
    const spec = {
      roles: ["Data Engineer"],
      skills: [],
      location: { country: "Canada", cities: [] },
      workMode: "remote" as const,
      employmentType: null,
      experience: { minYears: null, maxYears: null },
      salary: { min: null, max: null, currency: null },
      postedWithin: { value: null, unit: null },
      excludeTerms: [],
      seniority: null,
      industry: null,
      interpretation: "",
      confidence: "high" as const,
      explicitConstraints: [],
      inferredPreferences: [],
    };
    const hash1 = computeSearchHash(query, spec);
    const hash2 = computeSearchHash(query, spec);
    expect(hash1).toBe(hash2);
  });

  it("produces different hashes for different queries", () => {
    const spec = null;
    const hash1 = computeSearchHash("Data Engineer", spec);
    const hash2 = computeSearchHash("Backend Developer", spec);
    expect(hash1).not.toBe(hash2);
  });

  it("produces different hashes for different roles", () => {
    const query = "some query";
    const spec1 = {
      roles: ["Data Engineer"],
      skills: [],
      location: { country: null, cities: [] },
      workMode: "any" as const,
      employmentType: null,
      experience: { minYears: null, maxYears: null },
      salary: { min: null, max: null, currency: null },
      postedWithin: { value: null, unit: null },
      excludeTerms: [],
      seniority: null,
      industry: null,
      interpretation: "",
      confidence: "high" as const,
      explicitConstraints: [],
      inferredPreferences: [],
    };
    const spec2 = { ...spec1, roles: ["Backend Engineer"] };
    expect(computeSearchHash(query, spec1)).not.toBe(
      computeSearchHash(query, spec2),
    );
  });

  it("normalizes case in the query", () => {
    const spec = null;
    const hash1 = computeSearchHash("Data Engineer", spec);
    const hash2 = computeSearchHash("data engineer", spec);
    expect(hash1).toBe(hash2);
  });

  it("normalizes role order (sorted)", () => {
    const query = "some query";
    const spec1 = {
      roles: ["Data Engineer", "Backend Developer"],
      skills: [],
      location: { country: null, cities: [] },
      workMode: "any" as const,
      employmentType: null,
      experience: { minYears: null, maxYears: null },
      salary: { min: null, max: null, currency: null },
      postedWithin: { value: null, unit: null },
      excludeTerms: [],
      seniority: null,
      industry: null,
      interpretation: "",
      confidence: "high" as const,
      explicitConstraints: [],
      inferredPreferences: [],
    };
    const spec2 = { ...spec1, roles: ["Backend Developer", "Data Engineer"] };
    expect(computeSearchHash(query, spec1)).toBe(
      computeSearchHash(query, spec2),
    );
  });

  it("includes postedWithin in the hash", () => {
    const query = "some query";
    const spec1 = {
      roles: [],
      skills: [],
      location: { country: null, cities: [] },
      workMode: "any" as const,
      employmentType: null,
      experience: { minYears: null, maxYears: null },
      salary: { min: null, max: null, currency: null },
      postedWithin: { value: 24, unit: "hours" as const },
      excludeTerms: [],
      seniority: null,
      industry: null,
      interpretation: "",
      confidence: "high" as const,
      explicitConstraints: [],
      inferredPreferences: [],
    };
    const spec2 = {
      ...spec1,
      postedWithin: { value: 7, unit: "days" as const },
    };
    expect(computeSearchHash(query, spec1)).not.toBe(
      computeSearchHash(query, spec2),
    );
  });

  it("includes salary and exclude terms in the semantic hash", () => {
    const query = "some query";
    const base = {
      roles: [],
      skills: [],
      location: { country: null, cities: [] },
      workMode: "any" as const,
      employmentType: null,
      experience: { minYears: null, maxYears: null },
      salary: { min: null, max: null, currency: null },
      postedWithin: { value: null, unit: null },
      excludeTerms: [] as string[],
      seniority: null,
      industry: null,
      interpretation: "",
      confidence: "high" as const,
      explicitConstraints: [],
      inferredPreferences: [],
    };
    const withSalary = {
      ...base,
      salary: { min: 100000, max: null, currency: "CAD" },
    };
    const withExcludes = { ...base, excludeTerms: ["frontend"] };
    expect(computeSearchHash(query, base)).not.toBe(
      computeSearchHash(query, withSalary),
    );
    expect(computeSearchHash(query, base)).not.toBe(
      computeSearchHash(query, withExcludes),
    );
  });
});

describe("computeAdmissionHash", () => {
  it("is deterministic for the same normalized query and versions", () => {
    expect(computeAdmissionHash("Data Engineer in Canada")).toBe(
      computeAdmissionHash("data engineer   in canada"),
    );
  });

  it("differs for different queries", () => {
    expect(computeAdmissionHash("Data Engineer")).not.toBe(
      computeAdmissionHash("Backend Developer"),
    );
  });

  it("differs when the parser version changes", () => {
    const withV1 = JSON.parse(computeAdmissionHash("query"));
    const withV2 = JSON.parse(
      computeAdmissionHash("query", { sourcePlanVersion: "2" }),
    );
    expect(withV1[1]).toBe(JOB_SEARCH_PARSER_VERSION);
    expect(withV2[1]).toBe(JOB_SEARCH_PARSER_VERSION);
    expect(withV1[2]).toBe("1");
    expect(withV2[2]).toBe("2");
  });

  it("produces a unique nonce for fresh searches", () => {
    const a = computeAdmissionHash("same query", { fresh: true });
    const b = computeAdmissionHash("same query", { fresh: true });
    expect(a).not.toBe(b);
  });

  it("is identical for fresh=false or omitted", () => {
    expect(computeAdmissionHash("same query")).toBe(
      computeAdmissionHash("same query", { fresh: false }),
    );
  });
});
