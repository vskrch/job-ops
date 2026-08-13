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
  /**
   * Cancellation callback. When provided, the returned fetch function
   * aborts in-flight engine requests within ~1s of the callback returning
   * true. This is how pipeline `shouldCancel` propagates into the
   * engine so long-running captcha solves and browser-use tasks can be
   * interrupted at the next checkpoint.
   */
  shouldCancel?: () => boolean;
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
  const shouldCancel = options.shouldCancel;

  const engine = new CrawlEngine({
    behaviorProfile,
    crawl4ai: crawl4aiConfig,
  });

  // Only include `browser-use` in the chain when the env-based config
  // actually resolved a client — otherwise every request wastes a
  // round-trip on a "Browser Use not configured" final failure.
  const browserUseConfigured =
    Boolean(process.env.BROWSER_USE_BASE_URL?.trim()) ||
    Boolean(engine as unknown as { browserUse?: unknown });
  const browserUseAvailable = (() => {
    // CrawlEngine exposes `browserUse` only via the public API; peek at
    // a backdoor field is unsafe. Instead, rely on the existence of
    // BROWSER_USE_BASE_URL env. (If env is set but sidecar is down, the
    // backend fails fast and escalates — acceptable.)
    return Boolean(process.env.BROWSER_USE_BASE_URL?.trim());
  })();

  const backends = crawl4aiConfig
    ? browserUseAvailable
      ? (["direct", "crawl4ai", "jina", "browser-use"] as const)
      : (["direct", "crawl4ai", "jina"] as const)
    : browserUseAvailable
      ? (["direct", "jina", "browser-use"] as const)
      : (["direct", "jina"] as const);
  void browserUseConfigured;

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
    const callerSignal = init?.signal ?? undefined;

    // Compose the caller's signal with our shouldCancel poller. The
    // poller polls at 1s intervals (cheap) and aborts when either
    // signal fires.
    const composedSignal = composeAbortSignals(callerSignal, shouldCancel);

    const result: CrawlRequestResult = await engine.request({
      url,
      method: method as "GET" | "POST" | "PUT" | "DELETE",
      headers,
      body,
      backends,
      maxAttempts: 3,
      signal: composedSignal,
    });

    // Map CrawlEngine result back to a standard Response. Preserve the
    // original HTTP status when it's a real status; otherwise map
    // blocked/circuit-breaker/aborted cases to appropriate non-2xx codes
    // so extractors can detect and react.
    const status =
      result.ok && result.status >= 200
        ? result.status
        : result.status > 0
          ? result.status
          : result.blockDetected
            ? 502
            : 503;
    return new Response(result.text, {
      status,
      headers: result.contentType
        ? { "content-type": result.contentType }
        : undefined,
    });
  }) as typeof fetch;

  return crawledFetch;
}

/**
 * Combine an optional caller signal with a `shouldCancel` poller.
 * Returns `undefined` when neither is provided (no abort capability).
 * The poller ticks every 1s — cheap, and fast enough for cancellation
 * UX where multi-second tail latency is acceptable.
 */
function composeAbortSignals(
  callerSignal: AbortSignal | undefined,
  shouldCancel: (() => boolean) | undefined,
): AbortSignal | undefined {
  if (!callerSignal && !shouldCancel) return undefined;
  const controller = new AbortController();
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    callerSignal.addEventListener("abort", onCallerAbort, { once: true });
  }
  if (shouldCancel) {
    const interval = setInterval(() => {
      if (shouldCancel()) {
        controller.abort();
        clearInterval(interval);
      }
    }, 1000);
    controller.signal.addEventListener("abort", () => clearInterval(interval), {
      once: true,
    });
  }
  return controller.signal;
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
