/**
 * Tests for the deduplication module.
 */

import type { CreateJobInput } from "@shared/types";
import { describe, expect, it } from "vitest";
import { deduplicateJobs } from "./dedup";

function makeJob(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    source: "adzuna" as never,
    title: "Data Engineer",
    employer: "Tech Corp",
    jobUrl: "https://example.com/job/1",
    jobDescription: "A data engineering role requiring Python and Spark",
    location: "Toronto, Canada",
    ...overrides,
  };
}

describe("deduplicateJobs", () => {
  it("returns all jobs when there are no duplicates", () => {
    const jobs = [
      makeJob({ jobUrl: "https://example.com/1" }),
      makeJob({ jobUrl: "https://example.com/2", title: "Backend Engineer" }),
    ];
    const result = deduplicateJobs(jobs);
    expect(result.jobs).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it("removes exact URL duplicates", () => {
    const jobs = [
      makeJob({ jobUrl: "https://example.com/1", source: "adzuna" as never }),
      makeJob({ jobUrl: "https://example.com/1", source: "remotive" as never }),
    ];
    const result = deduplicateJobs(jobs);
    expect(result.jobs).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
    expect(result.jobs[0].sources).toEqual(["adzuna", "remotive"]);
  });

  it("removes duplicates by application link", () => {
    const jobs = [
      makeJob({
        jobUrl: "https://source1.com/1",
        applicationLink: "https://apply.com/1",
      }),
      makeJob({
        jobUrl: "https://source2.com/2",
        applicationLink: "https://apply.com/1",
      }),
    ];
    const result = deduplicateJobs(jobs);
    expect(result.jobs).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("removes duplicates by source job ID", () => {
    const jobs = [
      makeJob({
        source: "indeed" as never,
        sourceJobId: "abc123",
        jobUrl: "https://indeed.com/1",
      }),
      makeJob({
        source: "indeed" as never,
        sourceJobId: "abc123",
        jobUrl: "https://indeed.com/2",
      }),
    ];
    const result = deduplicateJobs(jobs);
    expect(result.jobs).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("removes content fingerprint duplicates (same employer + title + location)", () => {
    const jobs = [
      makeJob({
        jobUrl: "https://source1.com/1",
        employer: "Tech Corp",
        title: "Data Engineer",
        location: "Toronto, Canada",
      }),
      makeJob({
        jobUrl: "https://source2.com/2",
        employer: "Tech Corp",
        title: "Data Engineer",
        location: "Toronto, Canada",
      }),
    ];
    const result = deduplicateJobs(jobs);
    expect(result.jobs).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("does not deduplicate different jobs at the same employer", () => {
    const jobs = [
      makeJob({
        jobUrl: "https://source1.com/1",
        employer: "Tech Corp",
        title: "Data Engineer",
        location: "Toronto, Canada",
      }),
      makeJob({
        jobUrl: "https://source2.com/2",
        employer: "Tech Corp",
        title: "Frontend Developer",
        location: "Toronto, Canada",
      }),
    ];
    const result = deduplicateJobs(jobs);
    expect(result.jobs).toHaveLength(2);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it("normalizes URLs with tracking parameters", () => {
    const jobs = [
      makeJob({ jobUrl: "https://example.com/job/1?utm_source=google" }),
      makeJob({ jobUrl: "https://example.com/job/1" }),
    ];
    const result = deduplicateJobs(jobs);
    expect(result.jobs).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("normalizes URLs with trailing slashes", () => {
    const jobs = [
      makeJob({ jobUrl: "https://example.com/job/1/" }),
      makeJob({ jobUrl: "https://example.com/job/1" }),
    ];
    const result = deduplicateJobs(jobs);
    expect(result.jobs).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });

  it("keeps the more complete record when deduplicating", () => {
    const sparse = makeJob({
      jobUrl: "https://example.com/1",
      salary: undefined,
      jobDescription: undefined,
      skills: undefined,
    });
    const complete = makeJob({
      jobUrl: "https://example.com/1",
      source: "remotive" as never,
      salary: "CAD 120k",
      jobDescription: "Full description",
      skills: "Python, Spark",
    });
    const result = deduplicateJobs([sparse, complete]);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].salary).toBe("CAD 120k");
    expect(result.jobs[0].jobDescription).toBe("Full description");
  });

  it("merges source lists from all duplicate copies", () => {
    const jobs = [
      makeJob({ jobUrl: "https://example.com/1", source: "adzuna" as never }),
      makeJob({ jobUrl: "https://example.com/1", source: "remotive" as never }),
      makeJob({ jobUrl: "https://example.com/1", source: "indeed" as never }),
    ];
    const result = deduplicateJobs(jobs);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].sources).toHaveLength(3);
    expect(result.jobs[0].sources).toContain("adzuna");
    expect(result.jobs[0].sources).toContain("remotive");
    expect(result.jobs[0].sources).toContain("indeed");
    expect(result.duplicatesRemoved).toBe(2);
  });

  it("handles empty input", () => {
    const result = deduplicateJobs([]);
    expect(result.jobs).toHaveLength(0);
    expect(result.duplicatesRemoved).toBe(0);
  });

  it("handles within-source duplicates", () => {
    const jobs = [
      makeJob({ jobUrl: "https://example.com/1", source: "adzuna" as never }),
      makeJob({ jobUrl: "https://example.com/1", source: "adzuna" as never }),
    ];
    const result = deduplicateJobs(jobs);
    expect(result.jobs).toHaveLength(1);
    expect(result.duplicatesRemoved).toBe(1);
  });
});
