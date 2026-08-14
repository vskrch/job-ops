import type { CreateJobInput } from "@shared/types/jobs";
import { describe, expect, it } from "vitest";
import {
  filterJobsByNegativeKeywords,
  synthesizeCrawlTermsWithLlm,
} from "./enricher";

describe("crawler LLM service", () => {
  describe("filterJobsByNegativeKeywords", () => {
    const jobs: CreateJobInput[] = [
      {
        source: "remotive",
        sourceJobId: "job-1",
        title: "Senior Python Engineer",
        employer: "TechCorp",
        jobUrl: "https://example.com/1",
        applicationLink: "https://example.com/1",
      },
      {
        source: "remoteok",
        sourceJobId: "job-2",
        title: "Executive Sales Representative",
        employer: "SalesCorp",
        jobUrl: "https://example.com/2",
        applicationLink: "https://example.com/2",
      },
      {
        source: "weworkremotely",
        sourceJobId: "job-3",
        title: "Backend Developer (FastAPI/Python)",
        employer: "StartupX",
        jobUrl: "https://example.com/3",
        applicationLink: "https://example.com/3",
      },
      {
        source: "himalayas",
        sourceJobId: "job-4",
        title: "Summer Intern - Marketing",
        employer: "BrandCo",
        jobUrl: "https://example.com/4",
        applicationLink: "https://example.com/4",
      },
    ];

    it("filters out jobs matching negative keywords", () => {
      const negativeKeywords = ["sales", "marketing", "intern"];
      const filtered = filterJobsByNegativeKeywords(jobs, negativeKeywords);

      expect(filtered).toHaveLength(2);
      expect(filtered.map((j) => j.sourceJobId)).toEqual(["job-1", "job-3"]);
    });

    it("returns all jobs when negative keywords list is empty", () => {
      const filtered = filterJobsByNegativeKeywords(jobs, []);
      expect(filtered).toHaveLength(4);
    });
  });

  describe("synthesizeCrawlTermsWithLlm", () => {
    it("returns fallback terms when LLM crawling is disabled or fails gracefully", async () => {
      const result = await synthesizeCrawlTermsWithLlm({
        baseSearchTerms: ["python developer"],
        selectedCountry: "canada",
      });

      expect(result.searchTerms).toBeDefined();
      expect(result.searchTerms.length).toBeGreaterThan(0);
      expect(Array.isArray(result.negativeKeywords)).toBe(true);
    });
  });
});
