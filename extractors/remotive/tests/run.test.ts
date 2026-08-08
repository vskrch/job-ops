import { describe, expect, it, vi } from "vitest";
import { runRemotive } from "../src/run";

function createResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

describe("runRemotive", () => {
  it("maps jobs and filters by selected country including worldwide", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createResponse({
        jobs: [
          {
            id: 1,
            url: "https://remotive.com/remote-jobs/it/engineer-1",
            title: "Backend Engineer",
            company_name: "Acme",
            category: "Software Development",
            tags: ["backend", "nodejs"],
            job_type: "full_time",
            publication_date: "2026-08-01T00:00:00",
            candidate_required_location: "USA",
            salary: "",
            description: "<p>Build APIs.</p>",
          },
          {
            id: 2,
            url: "https://remotive.com/remote-jobs/it/designer-2",
            title: "Designer",
            company_name: "Beta",
            category: "Design",
            tags: ["ui"],
            job_type: "part_time",
            publication_date: "2026-08-02T00:00:00",
            candidate_required_location: "Europe",
            description: "<p>Design things.</p>",
          },
          {
            id: 3,
            url: "https://remotive.com/remote-jobs/it/dev-3",
            title: "DevOps Engineer",
            company_name: "Gamma",
            category: "Software Development",
            tags: ["aws"],
            job_type: "full_time",
            publication_date: "2026-08-03T00:00:00",
            candidate_required_location: "Anywhere",
            description: "<p>Infra work.</p>",
          },
        ],
      }),
    );

    const result = await runRemotive({
      searchTerms: ["engineer"],
      selectedCountry: "united states",
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        source: "remotive",
        title: "Backend Engineer",
        employer: "Acme",
        location: "USA",
        isRemote: true,
        jobType: "Full-time",
        sourceJobId: "1",
      }),
    );
    expect(result.jobs[1].title).toBe("DevOps Engineer");
  });

  it("returns success with an empty list on API failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500 } as Response);

    const result = await runRemotive({
      searchTerms: ["engineer"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
  });
});
