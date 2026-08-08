import { describe, expect, it } from "vitest";
import { CrawlEngine, type CrawlFetch } from "./engine";

function fakeResponse(status: number, body = "", contentType = "") {
  return {
    ok: status >= 200 && status < 400,
    status,
    statusText: String(status),
    text: async () => body,
    headers: {
      get: (name: string) => (name === "content-type" ? contentType : null),
    },
  } as const;
}

describe("CrawlEngine", () => {
  it("retries transient errors then returns the last failure without throwing", async () => {
    let calls = 0;
    const fetchImpl: CrawlFetch = () => {
      calls += 1;
      return Promise.resolve(fakeResponse(503, "down"));
    };

    const engine = new CrawlEngine({
      fetchImpl,
      userAgents: ["ua"],
      throttleMinMs: 0,
      throttleMaxMs: 0,
      // baseBackoff 1ms so the test is instant
    });

    const result = await engine.request({
      url: "https://example.com/jobs",
      maxAttempts: 3,
      baseBackoffMs: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(calls).toBe(3);
    expect(result.text).toBe("down");
  });

  it("succeeds on the second attempt after a transient 429", async () => {
    let calls = 0;
    const fetchImpl: CrawlFetch = () => {
      calls += 1;
      return Promise.resolve(
        fakeResponse(
          calls === 1 ? 429 : 200,
          '{"ok":true}',
          "application/json",
        ),
      );
    };

    const engine = new CrawlEngine({
      fetchImpl,
      throttleMinMs: 0,
      throttleMaxMs: 0,
    });

    const result = await engine.request({
      url: "https://example.com",
      maxAttempts: 2,
      baseBackoffMs: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(calls).toBe(2);
    expect(result.data).toEqual({ ok: true });
  });

  it("does not retry a permanent 404", async () => {
    let calls = 0;
    const fetchImpl: CrawlFetch = () => {
      calls += 1;
      return Promise.resolve(fakeResponse(404, "not found"));
    };
    const engine = new CrawlEngine({
      fetchImpl,
      throttleMinMs: 0,
      throttleMaxMs: 0,
    });

    const result = await engine.request({
      url: "https://example.com/x",
      maxAttempts: 3,
      baseBackoffMs: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect(calls).toBe(1);
  });

  it("rotates user agents between calls", async () => {
    const seen: string[] = [];
    const fetchImpl: CrawlFetch = (_url, init) => {
      seen.push(init.headers["user-agent"]);
      return Promise.resolve(fakeResponse(200));
    };
    const engine = new CrawlEngine({
      fetchImpl,
      userAgents: ["a", "b"],
      throttleMinMs: 0,
      throttleMaxMs: 0,
    });

    await engine.getJson({ url: "https://example.com", maxAttempts: 1 });
    await engine.getJson({ url: "https://example.com", maxAttempts: 1 });

    expect(seen).toEqual(["a", "b"]);
  });

  it("fails over to the jina backend when the direct fetch is blocked", async () => {
    const urls: string[] = [];
    const fetchImpl: CrawlFetch = (url, _init) => {
      urls.push(url);
      if (url.startsWith("https://r.jina.ai/")) {
        return Promise.resolve(fakeResponse(200, "# jobs here", "text/plain"));
      }
      return Promise.resolve(fakeResponse(403, "blocked"));
    };
    const engine = new CrawlEngine({
      fetchImpl,
      throttleMinMs: 0,
      throttleMaxMs: 0,
    });

    const result = await engine.request({
      url: "https://blocked.example/jobs?q=dev",
      backends: ["direct", "jina"],
      maxAttempts: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.backend).toBe("jina");
    expect(result.text).toBe("# jobs here");
    expect(urls).toEqual([
      "https://blocked.example/jobs?q=dev",
      "https://r.jina.ai/https%3A%2F%2Fblocked.example%2Fjobs%3Fq%3Ddev",
    ]);
  });

  it("skips the jina backend when the direct fetch succeeds", async () => {
    const urls: string[] = [];
    const fetchImpl: CrawlFetch = (url, _init) => {
      urls.push(url);
      return Promise.resolve(fakeResponse(200, "ok"));
    };
    const engine = new CrawlEngine({
      fetchImpl,
      throttleMinMs: 0,
      throttleMaxMs: 0,
    });

    const result = await engine.request({
      url: "https://example.com",
      backends: ["direct", "jina"],
      maxAttempts: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.backend).toBe("direct");
    expect(urls).toEqual(["https://example.com"]);
  });
});
