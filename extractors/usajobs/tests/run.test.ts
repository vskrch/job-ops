import { describe, expect, it, vi } from "vitest";
import { runUsaJobs } from "../src/run";

function createResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

const SEARCH_RESPONSE = {
  SearchResult: {
    SearchResultItems: [
      {
        MatchedObjectDescriptor: {
          PositionID: "ABC123",
          PositionTitle: "Software Engineer",
          OrganizationName: "Department of Defense",
          PositionURI: "https://www.usajobs.gov/GetJob/ViewDetails/ABC123",
          PositionLocation: [
            { CityName: "Arlington", State: "VA", CountryCode: "USA" },
          ],
          PublicationStartDate: "2026-08-01T00:00:00Z",
          ApplicationCloseDate: "2026-09-01T00:00:00Z",
          JobSummary: "Build critical systems.",
          SalaryMin: 100000,
          SalaryMax: 140000,
          RateIntervalCode: "Per Year",
          PositionOfferingType: [{ Name: "Remote" }],
          JobGrade: [{ Code: "13" }],
          ApplyURI: ["https://www.usajobs.gov/Apply/ABC123"],
        },
      },
    ],
  },
};

describe("runUsaJobs", () => {
  it("returns success with no jobs when the API key is missing", async () => {
    const previousKey = process.env.USAJOBS_API_KEY;
    delete process.env.USAJOBS_API_KEY;

    try {
      const result = await runUsaJobs({ searchTerms: ["engineer"] });
      expect(result.success).toBe(true);
      expect(result.jobs).toHaveLength(0);
      expect(result.error).toContain("USAJOBS_API_KEY");
    } finally {
      if (previousKey !== undefined) process.env.USAJOBS_API_KEY = previousKey;
    }
  });

  it("maps federal jobs when an API key is present", async () => {
    const previousKey = process.env.USAJOBS_API_KEY;
    process.env.USAJOBS_API_KEY = "test-key";
    const fetchMock = vi
      .fn()
      .mockResolvedValue(createResponse(SEARCH_RESPONSE));

    try {
      const result = await runUsaJobs({
        searchTerms: ["software engineer"],
        fetchImpl: fetchMock,
      });

      expect(result.success).toBe(true);
      expect(result.jobs).toHaveLength(1);
      expect(result.jobs[0]).toEqual(
        expect.objectContaining({
          source: "usajobs",
          title: "Software Engineer",
          employer: "Department of Defense",
          location: "Arlington, VA",
          isRemote: true,
          salary: "$100,000 - $140,000 / year",
          salaryMinAmount: 100000,
          salaryMaxAmount: 140000,
          salaryCurrency: "USD",
          salaryInterval: "yearly",
          jobLevel: "13",
          sourceJobId: "ABC123",
          deadline: "2026-09-01T00:00:00Z",
        }),
      );
      expect(fetchMock.mock.calls[0][0]).toContain("Keyword=software+engineer");
    } finally {
      if (previousKey !== undefined) process.env.USAJOBS_API_KEY = previousKey;
      else delete process.env.USAJOBS_API_KEY;
    }
  });
});
