import { describe, expect, it } from "vitest";
import { runAts } from "../src/run";

describe("ATS Extractor Dynamic Discovery", () => {
  it("uses dynamic defaults when no boards are specified and filters by query", async () => {
    const mockGhJobs = {
      jobs: [
        {
          id: 1,
          title: "Senior Backend Engineer - Python",
          absolute_url: "https://boards.greenhouse.io/stripe/jobs/1",
          location: { name: "Remote" },
          departments: [{ name: "Engineering" }],
          company_name: "Stripe",
        },
        {
          id: 2,
          title: "Account Executive",
          absolute_url: "https://boards.greenhouse.io/stripe/jobs/2",
          location: { name: "New York, NY" },
          departments: [{ name: "Sales" }],
          company_name: "Stripe",
        },
      ],
    };

    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("greenhouse.io")) {
        return new Response(JSON.stringify(mockGhJobs), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ jobs: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    const result = await runAts({
      searchTerms: ["python"],
      greenhouseBoards: ["stripe"],
      leverCompanies: [],
      ashbyOrgs: [],
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("Senior Backend Engineer - Python");
    expect(result.jobs[0].employer).toBe("Stripe");
  });
});
