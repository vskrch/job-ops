/**
 * Crawl engine shared by all job-board extractors.
 *
 * Provides layered anti-detection without coupling to any single site:
 *
 * - Humanized:   jittered request timing and rotating full browser
 *                fingerprints (UA + sec-ch-ua + platform + accept-language)
 *                so traffic looks like real browser diversity.
 * - Behavioral:  optional `BehaviorProfile` (fast|normal|cautious|stealth)
 *                controls inter-request spacing, hard min-intervals, and
 *                occasional long pauses that mimic a distracted user.
 * - LLM-aware:   optional block/CAPTCHA detection (heuristic first, LLM
 *                second) flags 200-OK challenge pages so the engine fails
 *                over to the next backend instead of parsing a CAPTCHA.
 * - Organic:     optional LLM-synthesized headers (Referer per domain) plus
 *                deterministic sec-fetch-* navigation headers.
 * - Adaptive:    per-site cooldown after a 429/block, plus a lightweight
 *                circuit breaker that trips after repeated failures and
 *                re-probes with half-open checks before resuming.
 * - Self-healing: every request is classified as transient vs permanent;
 *                transient errors retry with exponential backoff + jitter;
 *                a stale JINA_API_KEY is dropped and retried unauthenticated.
 * - Backend fallback: when one backend is blocked (403/429/5xx/network/captcha),
 *                requests fail over to the next ordered backend (e.g. the
 *                Jina Reader proxy at r.jina.ai) before giving up.
 *
 * Keep this dependency-free (no fetch impl bundled) so tests can inject
 * fetch. Extractors own their own error strings; nothing here throws.
 */

import {
  type BlockSignal,
  detectBlock,
  isBlockSignal,
} from "./block-detector.js";
import {
  type Crawl4AIConfig,
  type Crawl4AIResult,
  crawl4aiFetch,
} from "./crawl4ai-backend.js";
import {
  BROWSER_FINGERPRINTS,
  type BrowserFingerprint,
  DEFAULT_ACCEPT_LANGUAGE,
} from "./fingerprints.js";
import { buildOrganicHeaders } from "./organic-headers.js";

export const DEFAULT_USER_AGENTS = BROWSER_FINGERPRINTS.map(
  (fingerprint) => fingerprint.userAgent,
);

export type BehaviorProfile = "fast" | "normal" | "cautious" | "stealth";

export interface BehaviorProfileConfig {
  /** Dwell time on a page before the next request (ms). */
  thinkTimeMs: { min: number; max: number };
  /** Inter-request throttle floor (ms). */
  throttleMs: { min: number; max: number };
  /** Probability [0..1] of an occasional long pause. */
  longPauseChance: number;
  /** Duration of the occasional long pause (ms). */
  longPauseMs: { min: number; max: number };
}

/** Tuning per the crawler ADR; revisit if telemetry shows detection. */
export const BEHAVIOR_PROFILES: Record<BehaviorProfile, BehaviorProfileConfig> =
  {
    fast: {
      thinkTimeMs: { min: 200, max: 500 },
      throttleMs: { min: 400, max: 800 },
      longPauseChance: 0,
      longPauseMs: { min: 0, max: 0 },
    },
    normal: {
      thinkTimeMs: { min: 800, max: 1600 },
      throttleMs: { min: 800, max: 1600 },
      longPauseChance: 0.05,
      longPauseMs: { min: 3000, max: 8000 },
    },
    cautious: {
      thinkTimeMs: { min: 1500, max: 3000 },
      throttleMs: { min: 1500, max: 3000 },
      longPauseChance: 0.1,
      longPauseMs: { min: 5000, max: 15000 },
    },
    stealth: {
      thinkTimeMs: { min: 2500, max: 6000 },
      throttleMs: { min: 3000, max: 7000 },
      longPauseChance: 0.2,
      longPauseMs: { min: 8000, max: 30000 },
    },
  };

export interface CrawlRequestOptions {
  url: string;
  /**
   * Ordered backends tried in sequence. When a backend exhausts its retries
   * with a block/transient failure, the next backend is attempted.
   * `jina` proxies the URL through r.jina.ai (renders JS, bypasses IP blocks).
   * Defaults to `["direct"]`.
   */
  backends?: readonly CrawlBackend[];
  /** Extra headers merged over the rotated User-Agent. */
  headers?: Record<string, string>;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: string;
  /** Undici-style: body must be string at runtime; overridden below. */
  signal?: AbortSignal;
  /** Marks status codes/errors worth retrying (defaults to 5xx + 429 + 408). */
  retryableStatus?: readonly number[];
  /** Max attempts including the initial call (1 = no retry). */
  maxAttempts?: number;
  /** Base backoff ms, doubled per retry (jittered, capped). */
  baseBackoffMs?: number;
  /** Round-trip time hint used to space requests like a human (ms). */
  thinkTimeMs?: { min: number; max: number };
  /** Jina reader response format: `markdown` (default) or `html`. */
  jinaReturnFormat?: "markdown" | "html";
  /** Skip the in-memory response cache for this call. */
  cache?: boolean;
  /** Max response body bytes before the response is discarded. */
  maxBodyBytes?: number;
  /** Per-attempt timeout in ms; `0` disables (default 25s). */
  timeoutMs?: number;
  /** Behavioral pacing profile for this call (overrides engine default). */
  behaviorProfile?: BehaviorProfile;
}

export type CrawlBackend = "direct" | "crawl4ai" | "jina";

export interface CrawlRequestResult {
  ok: boolean;
  status: number;
  /** Parsed JSON when content-type is JSON and body is valid, else raw text. */
  data: unknown;
  text: string;
  attempt: number;
  /** How long the successful/failed call took (ms). */
  elapsedMs: number;
  /** Which backend produced this result (diagnostics). */
  backend: CrawlBackend;
  /** Content-Type of the response body ("" when unknown). */
  contentType: string;
  /** True when served from the engine's in-memory response cache. */
  cached: boolean;
  /** True when a 2xx body was classified as a block/CAPTCHA page. */
  blockDetected?: boolean;
  /** Classification signal when block detection ran. */
  blockSignal?: BlockSignal;
}

export type CrawlFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  statusText: string;
  text(): Promise<string>;
  headers: { get(name: string): string | null };
}>;

export interface CrawlEngineOptions {
  fetchImpl?: CrawlFetch;
  /** Backward compat: plain UA strings. Ignored when `fingerprints` is set. */
  userAgents?: readonly string[];
  /** Full browser fingerprints to rotate (default: BROWSER_FINGERPRINTS). */
  fingerprints?: readonly BrowserFingerprint[];
  /** Global minimum delay between requests (ms). 0 disables throttling. */
  throttleMinMs?: number;
  throttleMaxMs?: number;
  /** Max response body bytes before the response is discarded. */
  maxBodyBytes?: number;
  /** Per-attempt timeout in ms; `0` disables (default 25s). */
  timeoutMs?: number;
  /** Max cached responses (oldest evicted first). */
  cacheSize?: number;
  /** Default behavioral pacing profile for all requests. */
  behaviorProfile?: BehaviorProfile;
  /** Crawl4AI server config; enables the `crawl4ai` browser backend. */
  crawl4ai?: Crawl4AIConfig;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const RETRYABLE_STATUS = [408, 429, 500, 502, 503, 504];
const DEFAULT_BODY_LIMIT = 5_000_000;
const DEFAULT_TIMEOUT_MS = 25_000;
const MAX_BACKOFF_MS = 15_000;
const MAX_RETRY_AFTER_MS = 30_000;
const DEFAULT_CACHE_SIZE = 256;

function isTransientError(
  status: number,
  retryableStatus: readonly number[],
): boolean {
  return retryableStatus.includes(status);
}

export class CrawlEngine {
  private readonly fetchImpl: CrawlFetch;
  private readonly fingerprints: readonly BrowserFingerprint[];
  private readonly throttleMinMs: number;
  private readonly throttleMaxMs: number;
  private readonly maxBodyBytes: number;
  private readonly timeoutMs: number;
  private readonly cacheSize: number;
  private readonly behaviorProfile: BehaviorProfile | undefined;
  private readonly crawl4ai: Crawl4AIConfig | undefined;
  private readonly cache = new Map<string, CrawlRequestResult>();
  private lastRequestAt = 0;
  private rotateIndex = 0;

  constructor(options: CrawlEngineOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetchImplFallback;
    this.fingerprints =
      options.fingerprints ??
      (options.userAgents
        ? options.userAgents.map((ua) => ({
            label: ua.slice(0, 24),
            userAgent: ua,
            acceptLanguage: DEFAULT_ACCEPT_LANGUAGE,
          }))
        : BROWSER_FINGERPRINTS);
    this.throttleMinMs = options.throttleMinMs ?? 800;
    this.throttleMaxMs = options.throttleMaxMs ?? 1600;
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_BODY_LIMIT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.cacheSize = Math.max(0, options.cacheSize ?? DEFAULT_CACHE_SIZE);
    this.behaviorProfile = options.behaviorProfile;
    this.crawl4ai = options.crawl4ai;
  }

  /** Rotate to the next full browser fingerprint. */
  nextFingerprint(): BrowserFingerprint {
    const fingerprint =
      this.fingerprints[this.rotateIndex % this.fingerprints.length];
    this.rotateIndex += 1;
    return fingerprint;
  }

  /** Backward-compat: rotate just the UA string. */
  nextUserAgent(): string {
    return this.nextFingerprint().userAgent;
  }

  /** Resolve the active behavior profile for a request. */
  private resolveProfile(
    options: CrawlRequestOptions,
  ): BehaviorProfileConfig | null {
    const profile = options.behaviorProfile ?? this.behaviorProfile;
    return profile ? BEHAVIOR_PROFILES[profile] : null;
  }

  /** Sleep long enough to keep a human cadence between this engine's calls. */
  async pace(): Promise<void> {
    await this.paceWithProfile(undefined);
  }

  /** Pacing with an explicit behavior profile (per-request override). */
  private async paceWithProfile(
    options: CrawlRequestOptions | undefined,
  ): Promise<void> {
    const profile = options ? this.resolveProfile(options) : null;
    if (profile) {
      // Throttle floor: never fire two requests closer than throttleMs.min.
      const sinceLast = Date.now() - this.lastRequestAt;
      const throttle = randomInt(
        profile.throttleMs.min,
        profile.throttleMs.max,
      );
      const think = randomInt(profile.thinkTimeMs.min, profile.thinkTimeMs.max);
      const wait = Math.max(throttle - sinceLast, think - sinceLast);
      if (wait > 0) await sleep(wait);
      // Occasional long pause simulates a distracted / tab-switching user.
      if (
        profile.longPauseChance > 0 &&
        Math.random() < profile.longPauseChance
      ) {
        await sleep(
          randomInt(profile.longPauseMs.min, profile.longPauseMs.max),
        );
      }
      return;
    }
    if (this.throttleMinMs <= 0) return;
    const sinceLast = Date.now() - this.lastRequestAt;
    const natural = randomInt(this.throttleMinMs, this.throttleMaxMs);
    const wait = Math.max(0, natural - sinceLast);
    if (wait > 0) await sleep(wait);
  }

  private cacheKey(
    backend: CrawlBackend,
    options: CrawlRequestOptions,
  ): string {
    return [
      options.method ?? "GET",
      backend,
      options.jinaReturnFormat ?? "markdown",
      options.url,
    ].join("\u0000");
  }

  private getCached(
    backend: CrawlBackend,
    options: CrawlRequestOptions,
  ): CrawlRequestResult | null {
    if (options.cache === false || this.cacheSize === 0) return null;
    const hit = this.cache.get(this.cacheKey(backend, options));
    return hit ? { ...hit, cached: true, elapsedMs: 0 } : null;
  }

  private setCached(
    backend: CrawlBackend,
    options: CrawlRequestOptions,
    result: CrawlRequestResult,
  ): void {
    if (options.cache === false || this.cacheSize === 0) return;
    const key = this.cacheKey(backend, options);
    if (this.cache.has(key)) this.cache.delete(key);
    if (this.cache.size >= this.cacheSize) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { ...result, cached: false });
  }

  /**
   * Perform one HTTP call with humanized pacing, adaptive per-call backoff
   * across attempts, ordered backend fallback, and transient-error retry.
   * Never throws at the caller: returns a result with `ok:false` and the
   * last status/text on exhaustion.
   */
  async request(options: CrawlRequestOptions): Promise<CrawlRequestResult> {
    if (options.signal?.aborted) {
      return {
        ok: false,
        status: 0,
        data: undefined,
        text: "Aborted",
        attempt: 0,
        elapsedMs: 0,
        backend: "direct",
        contentType: "",
        cached: false,
        blockDetected: false,
        blockSignal: undefined,
      };
    }

    const backends =
      options.backends && options.backends.length > 0
        ? options.backends
        : (["direct"] as const);
    let lastResult: CrawlRequestResult | null = null;

    for (const backend of backends) {
      if (options.signal?.aborted) break;
      lastResult = this.getCached(backend, options) ?? null;
      if (lastResult) break;
      lastResult = await this.requestOnBackend(backend, options);
      if (lastResult.ok && options.cache !== false) {
        this.setCached(backend, options, lastResult);
      }
      if (lastResult.ok || options.signal?.aborted) break;
    }

    return (
      lastResult ?? {
        ok: false,
        status: 0,
        data: undefined,
        text: "No backends available",
        attempt: 0,
        elapsedMs: 0,
        backend: backends[0],
        contentType: "",
        cached: false,
        blockDetected: false,
        blockSignal: undefined,
      }
    );
  }

  private async requestOnBackend(
    backend: CrawlBackend,
    options: CrawlRequestOptions,
  ): Promise<CrawlRequestResult> {
    // Crawl4AI is a self-contained browser backend: it manages its own
    // browser pool, timeouts, and JS rendering, so we don't wrap it in the
    // HTTP retry loop. Map its result into the engine's shape directly.
    if (backend === "crawl4ai") {
      return this.requestOnCrawl4ai(options);
    }

    const url =
      backend === "jina"
        ? `https://r.jina.ai/${encodeURIComponent(options.url)}`
        : options.url;

    const jinaHeaders: Record<string, string> = {};
    if (backend === "jina") {
      // HTML mode lets callers run structured-data (JSON-LD) extraction on
      // the rendered page instead of guessing from markdown.
      if (options.jinaReturnFormat === "html") {
        jinaHeaders["x-return-format"] = "html";
      }
      const apiKey = process.env.JINA_API_KEY?.trim();
      if (apiKey) jinaHeaders.authorization = `Bearer ${apiKey}`;
    }

    const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    const baseBackoffMs = options.baseBackoffMs ?? 1500;
    const retryableStatus = options.retryableStatus ?? RETRYABLE_STATUS;
    const thinkTime = options.thinkTimeMs;
    const maxBodyBytes = options.maxBodyBytes ?? this.maxBodyBytes;
    const timeoutMs = options.timeoutMs ?? this.timeoutMs;

    let lastStatus = 0;
    let lastText = "";
    let retryAfterMs: number | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.signal?.aborted) break;
      await this.paceWithProfile(options);
      this.lastRequestAt = Date.now();
      retryAfterMs = undefined;

      const started = Date.now();
      let data: unknown;
      let text = "";
      let status = 0;
      let contentType = "";
      // A stale/invalid JINA_API_KEY 401s every jina call; drop the key once
      // and retry unauthenticated (self-healing).
      let droppedAuth = false;

      try {
        // One-shot timeout per attempt; caller-provided signals win.
        const attemptSignal =
          options.signal ??
          (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined);

        // Build the header set for this attempt. Direct fetches rotate the
        // full browser fingerprint and add organic (sec-fetch + referer)
        // headers; Jina fetches use a neutral reader UA.
        let baseHeaders: Record<string, string>;
        if (backend === "jina") {
          baseHeaders = {
            "user-agent": "Mozilla/5.0 (compatible; job-ops-crawler/1.0)",
            accept:
              "text/html,application/json,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": DEFAULT_ACCEPT_LANGUAGE,
          };
        } else {
          const fingerprint = this.nextFingerprint();
          baseHeaders = {
            "user-agent": fingerprint.userAgent,
            accept:
              "text/html,application/json,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          };
          if (fingerprint.secChUa) {
            baseHeaders["sec-ch-ua"] = fingerprint.secChUa;
            if (fingerprint.secChUaMobile)
              baseHeaders["sec-ch-ua-mobile"] = fingerprint.secChUaMobile;
            if (fingerprint.secChUaPlatform)
              baseHeaders["sec-ch-ua-platform"] = fingerprint.secChUaPlatform;
          }
          // Organic headers (sec-fetch-* + referer + occasional DNT) are
          // deterministic and always applied to direct fetches.
          const organic = buildOrganicHeaders(options.url, fingerprint);
          baseHeaders = { ...baseHeaders, ...organic };
        }

        const response = await this.fetchImpl(url, {
          method: options.method ?? "GET",
          headers: {
            ...baseHeaders,
            ...jinaHeaders,
            ...options.headers,
          },
          body:
            options.method && options.body !== undefined
              ? options.body
              : undefined,
          signal: attemptSignal,
        });
        status = response.status;
        lastStatus = status;
        contentType = response.headers.get("content-type") ?? "";
        retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
        text = await response.text();
        lastText = text;
        data = parseBody(text, contentType);

        if (
          status === 401 &&
          backend === "jina" &&
          "authorization" in jinaHeaders
        ) {
          delete jinaHeaders.authorization;
          droppedAuth = true;
        }
      } catch (error) {
        // Network-level transient failure (ECONNRESET, DNS, timeout).
        const message =
          error instanceof Error ? error.message : "Network error";
        lastText = message;
        data = undefined;
        status = 0;
        if (options.signal?.aborted) break;
      }

      const elapsedMs = Date.now() - started;

      if (status === 401 && droppedAuth && attempt < maxAttempts) {
        continue; // retry without the rejected key
      }

      if (text.length > maxBodyBytes) {
        return {
          ok: false,
          status,
          data: undefined,
          text: `Response body exceeds ${maxBodyBytes} bytes`,
          attempt,
          elapsedMs,
          backend,
          contentType,
          cached: false,
          blockDetected: false,
          blockSignal: undefined,
        };
      }

      const retryable =
        status === 0 || isTransientError(status, retryableStatus);
      const lastAttempt = attempt >= maxAttempts;

      if (!retryable || lastAttempt) {
        const isOk = status >= 200 && status < 400;
        // Heuristic block detection: a 200-OK challenge page is not a real
        // result. Classify (zero cost, no LLM) and fail over to the next
        // backend when blocked/captcha.
        let blockSignal: BlockSignal | undefined;
        let blockDetected = false;
        if (isOk && contentType.includes("html")) {
          blockSignal = detectBlock({ status, contentType, text });
          if (isBlockSignal(blockSignal)) {
            blockDetected = true;
            return {
              ok: false,
              status,
              data,
              text,
              attempt,
              elapsedMs,
              backend,
              contentType,
              cached: false,
              blockDetected,
              blockSignal,
            };
          }
        }
        // Human-like quiet pause between attempts models a user re-trying.
        if (thinkTime && thinkTime.min > 0) {
          await sleep(randomInt(thinkTime.min, thinkTime.max));
        }
        return {
          ok: isOk,
          status,
          data,
          text,
          attempt,
          elapsedMs,
          backend,
          contentType,
          cached: false,
          blockDetected,
          blockSignal,
        };
      }

      // Honor Retry-After when the site tells us how long to wait; otherwise
      // exponential backoff with full jitter, capped so we never sleep for
      // minutes on a misbehaving upstream.
      const backoff = Math.min(
        baseBackoffMs * 2 ** (attempt - 1),
        MAX_BACKOFF_MS,
      );
      const jittered = Math.floor(backoff * Math.random());
      await sleep(retryAfterMs ?? jittered);
    }

    return {
      ok: false,
      status: lastStatus,
      data: undefined,
      text: lastText,
      attempt: maxAttempts,
      elapsedMs: 0,
      backend,
      contentType: "",
      cached: false,
      blockDetected: false,
      blockSignal: undefined,
    };
  }

  /** Crawl4AI backend: delegate to the REST client, normalize the result. */
  private async requestOnCrawl4ai(
    options: CrawlRequestOptions,
  ): Promise<CrawlRequestResult> {
    if (!this.crawl4ai) {
      return {
        ok: false,
        status: 0,
        data: undefined,
        text: "Crawl4AI not configured",
        attempt: 0,
        elapsedMs: 0,
        backend: "crawl4ai",
        contentType: "",
        cached: false,
        blockDetected: false,
        blockSignal: undefined,
      };
    }
    if (options.signal?.aborted) {
      return {
        ok: false,
        status: 0,
        data: undefined,
        text: "Aborted",
        attempt: 0,
        elapsedMs: 0,
        backend: "crawl4ai",
        contentType: "",
        cached: false,
        blockDetected: false,
        blockSignal: undefined,
      };
    }

    await this.paceWithProfile(options);
    this.lastRequestAt = Date.now();
    const started = Date.now();

    const result: Crawl4AIResult = await crawl4aiFetch(
      options.url,
      this.crawl4ai,
      options.signal,
    );

    const elapsedMs = Date.now() - started;
    const text = result.markdown || result.html;
    const contentType = result.markdown ? "text/markdown" : "text/html";

    if (!result.ok) {
      return {
        ok: false,
        status: result.statusCode,
        data: undefined,
        text: result.error ?? "Crawl4AI request failed",
        attempt: 1,
        elapsedMs,
        backend: "crawl4ai",
        contentType: "",
        cached: false,
        blockDetected: false,
        blockSignal: undefined,
      };
    }

    // Run the same heuristic block detection on the browser-rendered body so
    // a challenge page surfaced by Crawl4AI escalates to Jina.
    let blockSignal: BlockSignal | undefined;
    let blockDetected = false;
    if (contentType.includes("html")) {
      blockSignal = detectBlock({
        status: result.statusCode,
        contentType,
        text,
      });
      if (isBlockSignal(blockSignal)) blockDetected = true;
    }

    return {
      ok: !blockDetected,
      status: result.statusCode,
      data: undefined,
      text,
      attempt: 1,
      elapsedMs,
      backend: "crawl4ai",
      contentType,
      cached: false,
      blockDetected,
      blockSignal,
    };
  }

  /** Convenience helper: happy-path JSON GET with sane defaults. */
  async getJson(options: {
    url: string;
    headers?: Record<string, string>;
    signal?: AbortSignal;
    maxAttempts?: number;
    retryableStatus?: readonly number[];
  }): Promise<CrawlRequestResult> {
    return this.request({
      ...options,
      headers: { accept: "application/json", ...options.headers },
    });
  }
}

export interface AdaptiveCircuit {
  /** How many consecutive failures before the breaker trips. */
  failureThreshold: number;
  /** Cooldown ms the circuit stays open before a half-open probe. */
  openMs: number;
  /** How many consecutive half-open successes re-close the circuit. */
  successThreshold: number;
}

class AdaptiveCircuitBreaker {
  private failures = 0;
  private successStreak = 0;
  private openedAt = 0;
  private halfOpen = false;

  constructor(private readonly config: AdaptiveCircuit) {}

  /** True when the circuit is open and should refuse work. */
  get isOpen(): boolean {
    if (this.openedAt === 0) return false;
    if (Date.now() - this.openedAt >= this.config.openMs) {
      this.halfOpen = true;
      return false; // allow a probe
    }
    return true;
  }

  recordSuccess(): void {
    if (this.halfOpen) {
      this.successStreak += 1;
      if (this.successStreak >= this.config.successThreshold) {
        this.halfOpen = false;
        this.openedAt = 0;
        this.failures = 0;
        this.successStreak = 0;
      }
    } else {
      this.failures = 0;
      this.successStreak = 0;
    }
  }

  recordFailure(): void {
    if (this.halfOpen) {
      // A failure during probe re-opens the circuit.
      this.halfOpen = false;
      this.openedAt = Date.now();
      this.successStreak = 0;
      return;
    }
    this.failures += 1;
    if (this.failures >= this.config.failureThreshold) {
      this.openedAt = Date.now();
      this.failures = 0;
    }
  }
}

/**
 * Adaptive per-source wrapper: tracks circuit state so a site that starts
 * blocking us is left alone (with periodic probes) instead of hammered.
 */
export class AdaptiveCooldown {
  private readonly breakers = new Map<string, AdaptiveCircuitBreaker>();

  constructor(
    private readonly config: AdaptiveCircuit,
    /** Called with the source when the circuit trips, useful for logging. */
    private readonly onTrip?: (source: string) => void,
  ) {}

  isAvailable(source: string): boolean {
    const breaker = this.breakers.get(source);
    if (!breaker) return true;
    if (breaker.isOpen) {
      // Currently open, but a probe may now be allowed; still refuse the
      // real work until a probe confirms recovery.
      return false;
    }
    return true;
  }

  /** Call with the outcome of a probe request to feed recovery. */
  probe(source: string, ok: boolean): void {
    const breaker = this.breakers.get(source) ?? this.newBreaker(source);
    if (ok) breaker.recordSuccess();
    else {
      breaker.recordFailure();
      this.onTrip?.(source);
    }
  }

  private newBreaker(source: string): AdaptiveCircuitBreaker {
    const breaker = new AdaptiveCircuitBreaker(this.config);
    this.breakers.set(source, breaker);
    return breaker;
  }
}

function parseBody(text: string, contentType: string): unknown {
  if (
    !contentType.includes("json") &&
    !contentType.startsWith("application/json")
  ) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Parse a Retry-After header (delta-seconds; HTTP dates are ignored). */
function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  const seconds = Number.parseInt(value.trim(), 10);
  if (Number.isNaN(seconds) || seconds < 0) return undefined;
  return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fetchImplFallback(
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal?: AbortSignal;
  },
) {
  const headers = new Headers(init.headers as Record<string, string>);
  let body: BodyInit | undefined;
  if (init.body !== undefined) body = init.body as string;
  return fetch(url, {
    method: init.method,
    headers,
    body,
    signal: init.signal,
  }) as ReturnType<CrawlFetch>;
}
