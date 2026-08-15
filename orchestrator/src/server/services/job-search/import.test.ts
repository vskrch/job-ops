import * as jobSearchRepo from "@server/repositories/job-search";
import * as jobsRepo from "@server/repositories/jobs";
import { describe, expect, it, vi } from "vitest";
import { importSearchJobsToTracked } from "./import";

describe("importSearchJobsToTracked", () => {
  it("returns zero counts if search is not found", async () => {
    vi.spyOn(jobSearchRepo, "getJobSearch").mockResolvedValueOnce(null);

    const result = await importSearchJobsToTracked("non-existent-id", {
      mode: "all",
    });

    expect(result).toEqual({ imported: 0, skipped: 0, duplicates: 0 });
  });

  it("imports high relevance jobs when mode is above_threshold", async () => {
    const mockSearch: any = {
      id: "search-123",
      results: {
        jobs: [
          {
            job: {
              title: "Senior Go Engineer",
              employer: "FastTech",
              jobUrl: "https://example.com/job/1",
              location: "Remote",
              source: "golangjobs",
            },
            relevanceScore: 85,
          },
          {
            job: {
              title: "Junior Data Analyst",
              employer: "SlowTech",
              jobUrl: "https://example.com/job/2",
              location: "Onsite",
              source: "adzuna",
            },
            relevanceScore: 40,
          },
        ],
      },
    };

    vi.spyOn(jobSearchRepo, "getJobSearch").mockResolvedValueOnce(mockSearch);
    vi.spyOn(jobsRepo, "createJobs").mockResolvedValueOnce({
      created: 1,
      skipped: 0,
    });

    const result = await importSearchJobsToTracked("search-123", {
      mode: "above_threshold",
      minRelevance: 70,
    });

    expect(result.imported).toBe(1);
    expect(jobsRepo.createJobs).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          title: "Senior Go Engineer",
          discoveredByRunId: "search-123",
        }),
      ],
      { discoveredByRunId: "search-123" },
    );
  });
});
