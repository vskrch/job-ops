import { describe, expect, it, vi } from "vitest";
import { runHnHiring } from "../src/run";

function createResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

const THREAD_SEARCH = {
  hits: [{ objectID: "12345", title: "Ask HN: Who is hiring? (August 2026)" }],
};

const THREAD_ITEM = {
  objectID: "12345",
  children: [
    {
      objectID: "999",
      created_at: "2026-08-01T10:00:00.000Z",
      text: [
        "| Acme | Senior Backend Engineer | Remote (USA) | https://acme.example/jobs/engineer",
        "| Beta | Product Designer | London, UK | https://beta.example/jobs/designer",
        "| Gamma | DevOps Engineer | India | https://gamma.example/jobs/devops",
      ].join("<p>"),
    },
  ],
};

describe("runHnHiring", () => {
  it("finds the latest thread and parses job table lines", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse(THREAD_SEARCH))
      .mockResolvedValueOnce(createResponse(THREAD_ITEM));

    const result = await runHnHiring({
      searchTerms: ["engineer"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        source: "hnhiring",
        title: "Senior Backend Engineer",
        employer: "Acme",
        location: "Remote (USA)",
        isRemote: true,
        applicationLink: "https://acme.example/jobs/engineer",
      }),
    );
  });

  it("filters by selected country", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse(THREAD_SEARCH))
      .mockResolvedValueOnce(createResponse(THREAD_ITEM));

    const result = await runHnHiring({
      searchTerms: [""],
      selectedCountry: "india",
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs.map((job) => job.employer)).toEqual(["Gamma"]);
  });

  it("returns an empty list when no thread is found", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse({ hits: [] }));

    const result = await runHnHiring({
      searchTerms: [""],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(0);
  });
});
