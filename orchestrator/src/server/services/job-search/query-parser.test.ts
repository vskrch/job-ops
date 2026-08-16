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

describe("parseSearchQuery & extractRuleBasedSearchSpec", () => {
  it("returns empty spec for empty query", async () => {
    const { parseSearchQuery } = await import("./query-parser");
    const result = await parseSearchQuery("   ");
    expect(result.roles).toEqual([]);
    expect(result.interpretation).toBe("");
  });

  it("accurately extracts roles, country, remote mode, experience, and freshness offline", async () => {
    const { extractRuleBasedSearchSpec } = await import("./query-parser");
    const spec = extractRuleBasedSearchSpec(
      "Data Engineer jobs in Canada, remote, 4-6 years experience, last 7 days",
    );

    expect(spec.roles).toContain("data engineer");
    expect(spec.location.country).toBe("canada");
    expect(spec.workMode).toBe("remote");
    expect(spec.experience.minYears).toBe(4);
    expect(spec.experience.maxYears).toBe(6);
    expect(spec.postedWithin).toEqual({ value: 7, unit: "days" });
  });

  it("extracts seniority, skills, city, hybrid mode, and freshness", async () => {
    const { extractRuleBasedSearchSpec } = await import("./query-parser");
    const spec = extractRuleBasedSearchSpec(
      "Senior Python developer jobs in Toronto, remote or hybrid, posted in the last 7 days",
    );

    expect(spec.roles).toContain("python developer");
    expect(spec.seniority).toBe("senior");
    expect(spec.skills).toContain("python");
    expect(spec.location.cities).toContain("Toronto");
    expect(spec.location.country).toBe("canada");
    expect(spec.workMode).toBe("hybrid");
    expect(spec.postedWithin).toEqual({ value: 7, unit: "days" });
  });

  it("extracts salary amount and currency, 24h freshness, and city", async () => {
    const { extractRuleBasedSearchSpec } = await import("./query-parser");
    const spec = extractRuleBasedSearchSpec(
      "Find backend engineering jobs in Vancouver paying over CAD 150k, posted in the last 24 hours",
    );

    expect(spec.roles).toContain("backend engineer");
    expect(spec.location.cities).toContain("Vancouver");
    expect(spec.location.country).toBe("canada");
    expect(spec.salary.min).toBe(150000);
    expect(spec.salary.currency).toBe("CAD");
    expect(spec.postedWithin).toEqual({ value: 24, unit: "hours" });
  });

  it("extracts 5+ years experience and ML roles across Canada", async () => {
    const { extractRuleBasedSearchSpec } = await import("./query-parser");
    const spec = extractRuleBasedSearchSpec(
      "Remote machine-learning engineer roles across Canada requiring 5+ years of experience",
    );

    expect(spec.roles).toContain("machine learning engineer");
    expect(spec.workMode).toBe("remote");
    expect(spec.location.country).toBe("canada");
    expect(spec.experience.minYears).toBe(5);
    expect(spec.experience.maxYears).toBeNull();
  });

  it("extracts London UK location, GBP currency, exclude terms, and skills", async () => {
    const { extractRuleBasedSearchSpec } = await import("./query-parser");
    const spec = extractRuleBasedSearchSpec(
      "Full stack React and TypeScript developer in London, £80k, exclude Java",
    );

    expect(spec.roles).toContain("full stack developer");
    expect(spec.skills).toContain("react");
    expect(spec.skills).toContain("typescript");
    expect(spec.location.cities).toContain("London");
    expect(spec.location.country).toBe("united kingdom");
    expect(spec.salary.min).toBe(80000);
    expect(spec.salary.currency).toBe("GBP");
    expect(spec.excludeTerms).toContain("java");
  });
});
