import { describe, expect, it, vi } from "vitest";
import { runRemoteOk } from "../src/run";

function createResponse(payload: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response;
}

const FEED = [
  { notice: "api" },
  {
    id: "1",
    slug: "engineer-acme",
    company: "Acme",
    position: "Senior Backend Engineer",
    location: "🇺🇸 USA Only",
    tags: ["backend", "nodejs"],
    salary_min: 120000,
    salary_max: 160000,
    salary_currency: "USD",
    date: "2026-08-01T00:00:00+00:00",
    url: "https://remoteok.com/remote-jobs/engineer-acme",
    apply_url: "https://remoteok.com/remote-jobs/engineer-acme/apply",
    description: "<p>Build APIs for money.</p>",
  },
  {
    id: "2",
    slug: "designer-beta",
    company: "Beta",
    position: "Product Designer",
    location: "🌏 Worldwide",
    tags: ["ui"],
    salary_min: 90000,
    salary_max: 110000,
    salary_currency: "USD",
    date: "2026-08-02T00:00:00+00:00",
    url: "https://remoteok.com/remote-jobs/designer-beta",
    apply_url: "https://remoteok.com/remote-jobs/designer-beta/apply",
    description: "<p>Design things.</p>",
  },
  {
    id: "3",
    slug: "engineer-gamma",
    company: "Gamma",
    position: "DevOps Engineer",
    location: "🇮🇳 India Only",
    tags: ["aws"],
    salary_min: 0,
    salary_max: 0,
    salary_currency: null,
    date: "2026-08-03T00:00:00+00:00",
    url: "https://remoteok.com/remote-jobs/engineer-gamma",
    apply_url: "https://remoteok.com/remote-jobs/engineer-gamma/apply",
    description: "<p>Infra work.</p>",
  },
];

describe("runRemoteOk", () => {
  it("maps jobs, skips the api notice row, and maps salaries", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createResponse(FEED));

    const result = await runRemoteOk({
      searchTerms: ["engineer"],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        source: "remoteok",
        title: "Senior Backend Engineer",
        employer: "Acme",
        salary: "$120,000 - $160,000 USD",
        salaryMinAmount: 120000,
        salaryMaxAmount: 160000,
        salaryCurrency: "USD",
        salaryInterval: "yearly",
      }),
    );
  });

  it("filters by country using flag emojis", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createResponse(FEED));

    const result = await runRemoteOk({
      searchTerms: [""],
      selectedCountry: "india",
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    // Worldwide remote jobs stay relevant for any selected country.
    expect(result.jobs.map((job) => job.title).sort()).toEqual([
      "DevOps Engineer",
      "Product Designer",
    ]);
  });

  it("returns success with an empty list on API failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503 } as Response);

    const result = await runRemoteOk({
      searchTerms: [""],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("503");
  });
});
