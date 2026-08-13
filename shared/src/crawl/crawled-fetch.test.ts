import { describe, expect, it } from "vitest";
import { createCrawledFetch } from "./crawled-fetch";

describe("createCrawledFetch", () => {
  it("returns a fetch-compatible function", () => {
    const fn = createCrawledFetch({ source: "test" });
    expect(typeof fn).toBe("function");
  });

  it("returns a Response object on a successful fetch", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response("job listing page", {
        status: 200,
        headers: { "content-type": "text/html" },
      })) as typeof fetch;
    try {
      const fn = createCrawledFetch({
        source: "test",
        behaviorProfile: "fast",
      });
      const response = await fn("https://example.com/jobs");
      expect(response).toBeInstanceOf(Response);
      expect(response.ok).toBe(true);
      const text = await response.text();
      expect(text).toBe("job listing page");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
