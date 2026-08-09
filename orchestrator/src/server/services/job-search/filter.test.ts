/**
 * Tests for the job search filter module.
 */

import type { CreateJobInput, ParsedSearchSpec } from "@shared/types";
import { describe, expect, it } from "vitest";
import { computeFreshnessWindow, filterJobs } from "./filter";

const baseJob: CreateJobInput = {
  source: "adzuna" as never,
  title: "Data Engineer",
  employer: "Tech Corp",
  jobUrl: "https://example.com/job/1",
  location: "Toronto, Canada",
  jobDescription: "A data engineering role",
  isRemote: true,
  jobType: "full_time",
  experienceRange: "4-6 years",
  salary: "CAD 120000 - 150000",
  salaryMinAmount: 120000,
  salaryCurrency: "CAD",
  datePosted: new Date().toISOString(),
  skills: "Python, Spark, SQL",
};

const baseSpec: ParsedSearchSpec = {
  roles: ["Data Engineer"],
  skills: ["Python", "Spark"],
  location: { country: "Canada", cities: ["Toronto"] },
  workMode: "remote",
  employmentType: "full_time",
  experience: { minYears: 4, maxYears: 6 },
  salary: { min: 100000, max: null, currency: "CAD" },
  postedWithin: { value: 24, unit: "hours" },
  excludeTerms: [],
  seniority: null,
  industry: null,
  interpretation: "",
  confidence: "high",
  explicitConstraints: ["roles", "location", "workMode", "experience"],
  inferredPreferences: ["skills"],
};

function makeJob(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return { ...baseJob, ...overrides };
}

function makeSpec(overrides: Partial<ParsedSearchSpec> = {}): ParsedSearchSpec {
  return { ...baseSpec, ...overrides };
}

describe("filterJobs", () => {
  it("passes a job that matches all constraints", () => {
    const results = filterJobs([makeJob()], makeSpec());
    expect(results).toHaveLength(1);
    expect(results[0].passed).toBe(true);
    expect(results[0].filterReason).toBeNull();
  });

  it("fails a job that doesn't match the role", () => {
    const job = makeJob({ title: "Sales Manager" });
    const results = filterJobs([job], makeSpec());
    expect(results[0].passed).toBe(false);
    expect(results[0].filterReason).toContain("roles");
  });

  it("fails a job in the wrong country", () => {
    const job = makeJob({ location: "London, UK" });
    const results = filterJobs([job], makeSpec());
    expect(results[0].passed).toBe(false);
    expect(results[0].filterReason).toContain("location");
  });

  it("fails a non-remote job when remote is required", () => {
    const job = makeJob({ isRemote: false });
    const results = filterJobs([job], makeSpec());
    expect(results[0].passed).toBe(false);
    expect(results[0].filterReason).toContain("workMode");
  });

  it("marks workMode as unverified when isRemote is not provided", () => {
    const job = makeJob({ isRemote: undefined, workFromHomeType: undefined });
    const results = filterJobs([job], makeSpec());
    expect(results[0].passed).toBe(true);
    expect(results[0].unverifiedConstraints).toContain("workMode");
  });

  it("fails a job outside experience range", () => {
    const job = makeJob({ experienceRange: "8-10 years" });
    const results = filterJobs(
      [job],
      makeSpec({ experience: { minYears: 4, maxYears: 6 } }),
    );
    expect(results[0].passed).toBe(false);
    expect(results[0].filterReason).toContain("experience");
  });

  it("marks experience as unverified when no experience data", () => {
    const job = makeJob({ experienceRange: undefined, jobLevel: undefined });
    const results = filterJobs([job], makeSpec());
    expect(results[0].passed).toBe(true);
    expect(results[0].unverifiedConstraints).toContain("experience");
  });

  it("fails a job below salary minimum", () => {
    const job = makeJob({ salaryMinAmount: 80000, salary: "CAD 80000" });
    const results = filterJobs(
      [job],
      makeSpec({ salary: { min: 100000, max: null, currency: "CAD" } }),
    );
    expect(results[0].passed).toBe(false);
    expect(results[0].filterReason).toContain("salary");
  });

  it("fails a job containing excluded terms", () => {
    const job = makeJob({
      title: "Data Engineer (no frontend)",
      jobDescription: "Must know React",
    });
    const results = filterJobs([job], makeSpec({ excludeTerms: ["React"] }));
    expect(results[0].passed).toBe(false);
    expect(results[0].filterReason).toContain("excludeTerms");
  });

  it("fails a job posted too long ago", () => {
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 5);
    const job = makeJob({ datePosted: oldDate.toISOString() });
    const results = filterJobs(
      [job],
      makeSpec({ postedWithin: { value: 24, unit: "hours" } }),
    );
    expect(results[0].passed).toBe(false);
    expect(results[0].filterReason).toContain("postedWithin");
  });

  it("marks postedWithin as unverified when no date", () => {
    const job = makeJob({ datePosted: undefined });
    const results = filterJobs([job], makeSpec());
    expect(results[0].passed).toBe(true);
    expect(results[0].unverifiedConstraints).toContain("postedWithin");
  });

  it("passes all jobs when spec has no constraints", () => {
    const emptySpec = makeSpec({
      roles: [],
      location: { country: null, cities: [] },
      workMode: "any",
      employmentType: null,
      experience: { minYears: null, maxYears: null },
      salary: { min: null, max: null, currency: null },
      postedWithin: { value: null, unit: null },
      excludeTerms: [],
    });
    const jobs = [makeJob(), makeJob({ title: "Something Else" })];
    const results = filterJobs(jobs, emptySpec);
    expect(results.every((r) => r.passed)).toBe(true);
  });

  it("correctly identifies verified constraints", () => {
    const results = filterJobs([makeJob()], makeSpec());
    expect(results[0].verifiedConstraints).toContain("roles");
    expect(results[0].verifiedConstraints).toContain("location");
    expect(results[0].verifiedConstraints).toContain("workMode");
    expect(results[0].verifiedConstraints).toContain("experience");
  });
});

describe("computeFreshnessWindow", () => {
  it("computes a 24-hour window", () => {
    const spec = makeSpec({ postedWithin: { value: 24, unit: "hours" } });
    const result = computeFreshnessWindow(spec, 5);
    expect(result.requested).toBe("last 24 hours");
    expect(result.effectiveStart).not.toBeNull();
    expect(result.effectiveEnd).not.toBeNull();
    expect(result.removedByFreshness).toBe(5);

    const start = new Date(result.effectiveStart ?? "");
    const end = new Date(result.effectiveEnd ?? "");
    const diffHours = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
    expect(diffHours).toBeCloseTo(24, 0);
  });

  it("computes a 7-day window", () => {
    const spec = makeSpec({ postedWithin: { value: 7, unit: "days" } });
    const result = computeFreshnessWindow(spec, 0);
    expect(result.requested).toBe("last 7 days");

    const start = new Date(result.effectiveStart ?? "");
    const end = new Date(result.effectiveEnd ?? "");
    const diffDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    expect(diffDays).toBeCloseTo(7, 0);
  });

  it("returns null window when no freshness specified", () => {
    const spec = makeSpec({ postedWithin: { value: null, unit: null } });
    const result = computeFreshnessWindow(spec, 0);
    expect(result.requested).toBeNull();
    expect(result.effectiveStart).toBeNull();
    expect(result.effectiveEnd).toBeNull();
  });

  it("returns null requested when unit is missing even if value is set", () => {
    const spec = makeSpec({ postedWithin: { value: 7, unit: null } });
    const result = computeFreshnessWindow(spec, 0);
    expect(result.requested).toBeNull();
  });
});
