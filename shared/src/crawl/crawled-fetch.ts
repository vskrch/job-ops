/**
 * CrawlEngine-backed fetch wrapper for raw-fetch extractors.
 *
 * The 11 simple extractors (talent, aijobs, hasjob, careerbuilder, workopolis,
 * remoteok, himalayas, remotive, weworkremotely, hnhiring, usajobs) currently
 * use raw `fetch()` with no anti-detection, retry, block detection, timeouts,
 * or pacing. This module provides a drop-in replacement with the same
 * `typeof fetch` signature so those extractors get all CrawlEngine benefits
 * without changing their call sites.
 *
 * Usage in an extractor's run.ts:
 *   ```ts
 *   import { createCrawledFetch } from "@shared/crawl/crawled-fetch.js";
 *
 *   const crawledFetch = createCrawledFetch({ source: "talent" });
 *   // pass as fetchImpl option
 *   const result = await runTalent({ ..., fetchImpl: crawledFetch });
 *   ```
 *
 * The wrapper transparently:
 *   - Rotates browser fingerprints (UA + sec-ch-ua + platform)
 *   - Adds organic headers (Referer from Google, sec-fetch-* set)
 *   - Paces requests with the configured behavior profile
 *   - Detects blocks/CAPTCHAs and escalates to crawl4ai → jina → browser-use
 *   - Retries transient errors with exponential backoff
 *   - Enforces timeouts
 */

import type { Crawl4AIConfig } from "./crawl4ai-backend.js";
import { CrawlEngine, type CrawlRequestResult } from "./engine.js";

export interface CrawledFetchOptions {
  /** Source ID for logging/diagnostics (e.g., "talent", "remoteok"). */
  source?: string;
  /** Behavior profile (default: "normal"). */
  behaviorProfile?: "fast" | "normal" | "cautious" | "stealth";
  /** Override Crawl4AI config; defaults to env-based config. */
  crawl4ai?: Crawl4AIConfig;
}

/**
 * Create a `fetch`-compatible function backed by CrawlEngine.
 * Returns the same shape as global `fetch` so it's a drop-in replacement
 * for `fetchImpl` parameters in extractor run functions.
 */
export function createCrawledFetch(
  options: CrawledFetchOptions = {},
): typeof fetch {
  const behaviorProfile = options.behaviorProfile ?? "normal";
  const crawl4aiConfig = options.crawl4ai ?? readCrawl4aiConfig() ?? undefined;

  const engine = new CrawlEngine({
    behaviorProfile,
    crawl4ai: crawl4aiConfig,
  });

  // Full escalation chain: direct → crawl4ai → jina → browser-use.
  // The engine constructor auto-initializes browserUse from env, so
  // the "browser-use" backend is available when BROWSER_USE_BASE_URL is set.
  const backends = crawl4aiConfig
    ? (["direct", "crawl4ai", "jina", "browser-use"] as const)
    : (["direct", "jina", "browser-use"] as const);

  const crawledFetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof input === "string" ? input : input.toString();
    const method = init?.method ?? "GET";
    const headers = init?.headers
      ? init.headers instanceof Headers
        ? Object.fromEntries(init.headers.entries())
        : (init.headers as Record<string, string>)
      : {};
    const body = typeof init?.body === "string" ? init.body : undefined;
    const signal = init?.signal ?? undefined;

    const result: CrawlRequestResult = await engine.request({
      url,
      method: method as "GET" | "POST" | "PUT" | "DELETE",
      headers,
      body,
      backends,
      maxAttempts: 3,
      signal: signal ?? undefined,
    });

    // Map CrawlEngine result back to a standard Response.
    return new Response(result.text, {
      status: result.ok && result.status >= 200 ? result.status : 502,
      headers: result.contentType
        ? { "content-type": result.contentType }
        : undefined,
    });
  }) as typeof fetch;

  return crawledFetch;
}

/** Read Crawl4AI config from env (shared with jobboards extractor). */
function readCrawl4aiConfig(): Crawl4AIConfig | undefined {
  const baseUrl = process.env.CRAWL4AI_BASE_URL?.trim();
  if (!baseUrl) return undefined;
  return {
    baseUrl,
    apiToken: process.env.CRAWL4AI_API_TOKEN?.trim() || undefined,
    undetectedBrowser: process.env.CRAWL4AI_UNDETECTED?.trim() === "true",
  };
}
