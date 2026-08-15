import { describe, expect, it } from "vitest";
import { duckDuckGoAdapter } from "./duckduckgo";
import { freeAggregatorsAdapter } from "./free-aggregators";
import { getAvailableMetaAdapters, runMetaSearchAdapter } from "./index";
import { serpApiAdapter } from "./serpapi";
import type { MetaSearchParams } from "./types";

describe("Meta-Search Adapters", () => {
  const sampleParams: MetaSearchParams = {
    terms: ["Frontend Engineer", "React"],
    location: { country: "Canada", cities: ["Toronto"] },
    workMode: "remote",
    maxPages: 1,
    timeoutMs: 5000,
  };

  it("duckDuckGoAdapter is always available with 0 API keys", async () => {
    const available = await duckDuckGoAdapter.available();
    expect(available).toBe(true);
  });

  it("freeAggregatorsAdapter is always available with 0 API keys", async () => {
    const available = await freeAggregatorsAdapter.available();
    expect(available).toBe(true);
  });

  it("serpApiAdapter availability depends on apiKey", async () => {
    // If no SERPAPI_KEY is in env, available should return false
    const origKey = process.env.SERPAPI_KEY;
    delete process.env.SERPAPI_KEY;
    const availableNoKey = await serpApiAdapter.available();
    expect(availableNoKey).toBe(false);

    process.env.SERPAPI_KEY = "test-token";
    const availableWithKey = await serpApiAdapter.available();
    expect(availableWithKey).toBe(true);

    if (origKey) process.env.SERPAPI_KEY = origKey;
    else delete process.env.SERPAPI_KEY;
  });

  it("getAvailableMetaAdapters returns prioritized free adapters first", async () => {
    const adapters = await getAvailableMetaAdapters();
    expect(adapters.length).toBeGreaterThanOrEqual(2);
    expect(adapters[0].id).toBe("free-duckduckgo");
    expect(adapters[1].id).toBe("free-public-aggregators");
  });

  it("runMetaSearchAdapter safely executes and returns structured result", async () => {
    const mockAdapter = {
      id: "mock-test",
      displayName: "Mock Test Adapter",
      available: async () => true,
      search: async function* () {
        yield [
          {
            title: "Staff Platform Engineer",
            employer: "CloudCorp",
            jobUrl: "https://cloudcorp.example.com/jobs/1",
            location: "Remote",
            source: "manual" as const,
          },
        ];
      },
    };

    const result = await runMetaSearchAdapter(mockAdapter, sampleParams);
    expect(result.status).toBe("succeeded");
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("Staff Platform Engineer");
  });
});
