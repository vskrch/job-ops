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

function fakeResponseWithHeaders(
  status: number,
  body: string,
  headers: Record<string, string>,
) {
  return {
    ok: status >= 200 && status < 400,
    status,
    statusText: String(status),
    text: async () => body,
    headers: {
      get: (name: string) => headers[name] ?? null,
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

    await engine.getJson({ url: "https://example.com/1", maxAttempts: 1 });
    await engine.getJson({ url: "https://example.com/2", maxAttempts: 1 });

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

  it("serves repeated identical requests from the response cache", async () => {
    let calls = 0;
    const fetchImpl: CrawlFetch = () => {
      calls += 1;
      return Promise.resolve(fakeResponse(200, "cached body", "text/html"));
    };
    const engine = new CrawlEngine({
      fetchImpl,
      throttleMinMs: 0,
      throttleMaxMs: 0,
    });

    const first = await engine.request({
      url: "https://example.com/jobs?q=dev",
      maxAttempts: 1,
    });
    const second = await engine.request({
      url: "https://example.com/jobs?q=dev",
      maxAttempts: 1,
    });

    expect(calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.ok).toBe(true);
    expect(second.text).toBe("cached body");
    expect(second.contentType).toBe("text/html");
  });

  it("skips the cache for a different backend or return format", async () => {
    const urls: string[] = [];
    const fetchImpl: CrawlFetch = (url) => {
      urls.push(url);
      return Promise.resolve(fakeResponse(200, "body", "text/plain"));
    };
    const engine = new CrawlEngine({
      fetchImpl,
      throttleMinMs: 0,
      throttleMaxMs: 0,
    });

    await engine.request({
      url: "https://example.com",
      backends: ["jina"],
      maxAttempts: 1,
      jinaReturnFormat: "markdown",
    });
    await engine.request({
      url: "https://example.com",
      backends: ["jina"],
      maxAttempts: 1,
      jinaReturnFormat: "html",
    });

    expect(urls).toHaveLength(2);
  });

  it("honors Retry-After before retrying a 429", async () => {
    const sleeps: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    // Stub setTimeout: record the delay and resolve immediately so the test
    // is deterministic (no real waiting).
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      sleeps.push(ms ?? 0);
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout;

    let calls = 0;
    const fetchImpl: CrawlFetch = () => {
      calls += 1;
      return Promise.resolve(
        fakeResponseWithHeaders(calls === 1 ? 429 : 200, "ok", {
          "retry-after": "1",
        }),
      );
    };
    try {
      const engine = new CrawlEngine({
        fetchImpl,
        throttleMinMs: 0,
        throttleMaxMs: 0,
      });

      const result = await engine.request({
        url: "https://example.com",
        maxAttempts: 2,
        baseBackoffMs: 50_000,
      });

      expect(result.ok).toBe(true);
      expect(calls).toBe(2);
      // Retry-After (1s) wins over the 50s jittered backoff.
      expect(sleeps).toEqual([1000]);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
  });

  it("discards response bodies over the size cap without retrying", async () => {
    let calls = 0;
    const fetchImpl: CrawlFetch = () => {
      calls += 1;
      return Promise.resolve(fakeResponse(200, "x".repeat(100), "text/html"));
    };
    const engine = new CrawlEngine({
      fetchImpl,
      throttleMinMs: 0,
      throttleMaxMs: 0,
      maxBodyBytes: 10,
    });

    const result = await engine.request({
      url: "https://example.com/huge",
      maxAttempts: 3,
    });

    expect(result.ok).toBe(false);
    expect(result.text).toContain("exceeds 10 bytes");
    expect(calls).toBe(1);
  });

  it("requests html from jina when jinaReturnFormat is html", async () => {
    let sawFormatHeader = "";
    const fetchImpl: CrawlFetch = (_url, init) => {
      sawFormatHeader = init.headers["x-return-format"] ?? "";
      return Promise.resolve(fakeResponse(200, "<html>hi</html>", "text/html"));
    };
    const engine = new CrawlEngine({
      fetchImpl,
      throttleMinMs: 0,
      throttleMaxMs: 0,
    });

    const result = await engine.request({
      url: "https://example.com",
      backends: ["jina"],
      maxAttempts: 1,
      jinaReturnFormat: "html",
    });

    expect(sawFormatHeader).toBe("html");
    expect(result.contentType).toBe("text/html");
  });

  it("drops a rejected JINA_API_KEY and retries unauthenticated", async () => {
    const authHeaders: (string | undefined)[] = [];
    let calls = 0;
    const fetchImpl: CrawlFetch = (_url, init) => {
      calls += 1;
      authHeaders.push(init.headers.authorization);
      return Promise.resolve(
        fakeResponse(calls === 1 ? 401 : 200, "ok", "text/plain"),
      );
    };
    const previousKey = process.env.JINA_API_KEY;
    process.env.JINA_API_KEY = "stale-key";
    try {
      const engine = new CrawlEngine({
        fetchImpl,
        throttleMinMs: 0,
        throttleMaxMs: 0,
      });

      const result = await engine.request({
        url: "https://example.com",
        backends: ["jina"],
        maxAttempts: 3,
      });

      expect(result.ok).toBe(true);
      expect(calls).toBe(2);
      expect(authHeaders).toEqual(["Bearer stale-key", undefined]);
    } finally {
      if (previousKey === undefined) delete process.env.JINA_API_KEY;
      else process.env.JINA_API_KEY = previousKey;
    }
  });

  it("rotates the full fingerprint (UA + sec-ch-ua + platform) together", async () => {
    const seen: {
      ua: string;
      chUa: string | undefined;
      platform: string | undefined;
    }[] = [];
    const fetchImpl: CrawlFetch = (_url, init) => {
      seen.push({
        ua: init.headers["user-agent"],
        chUa: init.headers["sec-ch-ua"],
        platform: init.headers["sec-ch-ua-platform"],
      });
      return Promise.resolve(fakeResponse(200, "ok"));
    };
    const engine = new CrawlEngine({
      fetchImpl,
      fingerprints: [
        {
          label: "a",
          userAgent: "UA-A",
          secChUa: '"A"',
          secChUaMobile: "?0",
          secChUaPlatform: '"Windows"',
          acceptLanguage: "en-US",
        },
        {
          label: "b",
          userAgent: "UA-B",
          secChUa: '"B"',
          secChUaMobile: "?0",
          secChUaPlatform: '"macOS"',
          acceptLanguage: "en-GB",
        },
      ],
      throttleMinMs: 0,
      throttleMaxMs: 0,
    });

    await engine.request({ url: "https://example.com/1", maxAttempts: 1 });
    await engine.request({ url: "https://example.com/2", maxAttempts: 1 });

    expect(seen).toHaveLength(2);
    expect(seen[0]).toEqual({ ua: "UA-A", chUa: '"A"', platform: '"Windows"' });
    expect(seen[1]).toEqual({ ua: "UA-B", chUa: '"B"', platform: '"macOS"' });
  });

  it("fails over to jina when a 200-OK page is a heuristic CAPTCHA block", async () => {
    const urls: string[] = [];
    const fetchImpl: CrawlFetch = (url) => {
      urls.push(url);
      if (url.startsWith("https://r.jina.ai/")) {
        return Promise.resolve(fakeResponse(200, "# real jobs", "text/plain"));
      }
      return Promise.resolve(
        fakeResponse(
          200,
          "<html><title>Just a moment...</title>cf-challenge</html>",
          "text/html",
        ),
      );
    };
    const engine = new CrawlEngine({
      fetchImpl,
      throttleMinMs: 0,
      throttleMaxMs: 0,
    });

    const result = await engine.request({
      url: "https://blocked.example/jobs",
      backends: ["direct", "jina"],
      maxAttempts: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.backend).toBe("jina");
    expect(result.text).toBe("# real jobs");
  });

  it("propagates the blockDetected flag on a blocked direct response", async () => {
    const fetchImpl: CrawlFetch = () =>
      Promise.resolve(
        fakeResponse(
          200,
          "<html>Access Denied. You have been blocked.</html>",
          "text/html",
        ),
      );
    const engine = new CrawlEngine({
      fetchImpl,
      throttleMinMs: 0,
      throttleMaxMs: 0,
    });

    const result = await engine.request({
      url: "https://blocked.example/jobs",
      backends: ["direct"],
      maxAttempts: 1,
    });

    expect(result.ok).toBe(false);
    expect(result.blockDetected).toBe(true);
    expect(result.blockSignal).toBe("blocked");
  });

  it("triggers an occasional long pause under a cautious behavior profile", async () => {
    const sleeps: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    globalThis.setTimeout = ((fn: () => void, ms?: number) => {
      sleeps.push(ms ?? 0);
      fn();
      return 0 as unknown as NodeJS.Timeout;
    }) as typeof setTimeout;

    // Force long-pause by pinning Math.random to 0 (below cautious
    // longPauseChance 0.12, and randomInt returns its min).
    const originalRandom = Math.random;
    Math.random = () => 0;

    const fetchImpl: CrawlFetch = () =>
      Promise.resolve(fakeResponse(200, "ok"));
    try {
      const engine = new CrawlEngine({
        fetchImpl,
        behaviorProfile: "cautious",
        throttleMinMs: 0,
        throttleMaxMs: 0,
      });

      await engine.request({ url: "https://example.com", maxAttempts: 1 });

      // A cautious long pause is 5000-15000ms; it must appear in the sleeps.
      const longPause = sleeps.find((ms) => ms >= 5000);
      expect(longPause).toBeGreaterThanOrEqual(5000);
    } finally {
      globalThis.setTimeout = originalSetTimeout;
      Math.random = originalRandom;
    }
  });

  it("escalates direct(blocked) -> crawl4ai(ok) and skips jina", async () => {
    const urls: string[] = [];
    const fetchImpl: CrawlFetch = (url) => {
      urls.push(url);
      // direct returns a Cloudflare challenge; crawl4ai is mocked via fetch
      // returning the crawl4ai /crawl response; jina should never be reached.
      if (url.startsWith("https://r.jina.ai/")) {
        return Promise.resolve(
          fakeResponse(200, "should not reach", "text/plain"),
        );
      }
      if (url.includes("r.jina.ai")) {
        return Promise.resolve(fakeResponse(200, "no", "text/plain"));
      }
      return Promise.resolve(
        fakeResponse(200, "<html>cf-challenge</html>", "text/html"),
      );
    };
    // Mock Crawl4AI by stubbing global fetch for the /crawl POST.
    const originalFetch = globalThis.fetch;
    let crawl4aiCalled = false;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const target = String(input);
      if (target.endsWith("/crawl")) {
        crawl4aiCalled = true;
        return new Response(
          JSON.stringify({
            results: [
              {
                markdown: "# rendered jobs",
                html: "<html></html>",
                status_code: 200,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ) as Response;
      }
      // direct + jina go through fetchImpl
      return fetchImpl(String(input), {
        method: init?.method ?? "GET",
        headers: (init?.headers as Record<string, string>) ?? {},
        body: init?.body as string | undefined,
        signal: init?.signal,
      });
    }) as typeof fetch;

    try {
      const engine = new CrawlEngine({
        fetchImpl,
        throttleMinMs: 0,
        throttleMaxMs: 0,
        crawl4ai: { baseUrl: "http://crawl4ai:11235" },
      });

      const result = await engine.request({
        url: "https://blocked.example/jobs",
        backends: ["direct", "crawl4ai", "jina"],
        maxAttempts: 1,
      });

      expect(result.ok).toBe(true);
      expect(result.backend).toBe("crawl4ai");
      expect(result.text).toBe("# rendered jobs");
      expect(crawl4aiCalled).toBe(true);
      // jina must not have been hit.
      expect(urls.some((u) => u.startsWith("https://r.jina.ai/"))).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("escalates direct(blocked) -> crawl4ai(blocked) -> jina(ok)", async () => {
    const jinaUrls: string[] = [];
    const fetchImpl: CrawlFetch = (url) => {
      if (url.startsWith("https://r.jina.ai/")) {
        jinaUrls.push(url);
        return Promise.resolve(fakeResponse(200, "# jina jobs", "text/plain"));
      }
      // direct returns blocked
      return Promise.resolve(
        fakeResponse(
          200,
          "<html>Just a moment... cf-challenge</html>",
          "text/html",
        ),
      );
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const target = String(input);
      if (target.endsWith("/crawl")) {
        // crawl4ai also returns a captcha body.
        return new Response(
          JSON.stringify({
            results: [
              {
                markdown: "",
                html: "<html>Verify you are human</html>",
                status_code: 200,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ) as Response;
      }
      return fetchImpl(String(input), {
        method: init?.method ?? "GET",
        headers: (init?.headers as Record<string, string>) ?? {},
        body: init?.body as string | undefined,
        signal: init?.signal,
      });
    }) as typeof fetch;

    try {
      const engine = new CrawlEngine({
        fetchImpl,
        throttleMinMs: 0,
        throttleMaxMs: 0,
        crawl4ai: { baseUrl: "http://crawl4ai:11235" },
      });

      const result = await engine.request({
        url: "https://blocked.example/jobs",
        backends: ["direct", "crawl4ai", "jina"],
        maxAttempts: 1,
      });

      expect(result.ok).toBe(true);
      expect(result.backend).toBe("jina");
      expect(result.text).toBe("# jina jobs");
      expect(jinaUrls).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
