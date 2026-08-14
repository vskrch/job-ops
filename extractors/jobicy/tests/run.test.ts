import { describe, expect, it } from "vitest";
import { runJobicy } from "../src/run";

describe("Jobicy Extractor", () => {
  it("parses jobicy response correctly", async () => {
    const mockJobs = [
      {
        id: 101,
        url: "https://jobicy.com/jobs/101-python-engineer",
        jobTitle: "Senior Python Backend Engineer",
        companyName: "RemoteTech Inc",
        jobGeo: "Worldwide",
        jobType: "full-time",
        jobLevel: "Senior",
        jobDescription: "<p>We are looking for a Python FastAPI developer.</p>",
        pubDate: "2026-08-10T12:00:00Z",
        annualSalaryMin: 120000,
        annualSalaryMax: 150000,
        salaryCurrency: "USD",
      },
    ];

    const mockFetch = async () =>
      new Response(JSON.stringify({ jobs: mockJobs }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const result = await runJobicy({
      searchTerms: ["python"],
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("Senior Python Backend Engineer");
    expect(result.jobs[0].employer).toBe("RemoteTech Inc");
    expect(result.jobs[0].salary).toBe("USD 120,000 - 150,000");
    expect(result.jobs[0].isRemote).toBe(true);
  });
});
