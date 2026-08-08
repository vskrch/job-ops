/**
 * Crawl engine shared by all job-board extractors.
 *
 * Provides three behaviors without coupling to any single site:
 *
 * - Humanized:   jittered request timing and rotating desktop user agents so
 *                traffic patterns look organic instead of bursty.
 * - Adaptive:    per-site cooldown after a 429/block, plus a lightweight
 *                circuit breaker that trips after repeated failures and
 *                re-probes with half-open checks before resuming.
 * - Self-healing: every request is classified as transient vs permanent;
 *                transient errors retry with exponential backoff + jitter.
 *
 * Keep this dependency-free (no fetch impl bundled) so tests can inject
 * fetch. Extractors own their own error strings; nothing here throws.
 */

export const DEFAULT_USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
] as const;

export interface CrawlRequestOptions {
  url: string;
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
  /** Base backoff ms, doubled per retry (jittered). */
  baseBackoffMs?: number;
  /** Round-trip time hint used to space requests like a human (ms). */
  thinkTimeMs?: { min: number; max: number };
}

export interface CrawlRequestResult {
  ok: boolean;
  status: number;
  /** Parsed JSON when content-type is JSON and body is valid, else raw text. */
  data: unknown;
  text: string;
  attempt: number;
  /** How long the successful/failed call took (ms). */
  elapsedMs: number;
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
  userAgents?: readonly string[];
  /** Global minimum delay between requests (ms). 0 disables throttling. */
  throttleMinMs?: number;
  throttleMaxMs?: number;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const RETRYABLE_STATUS = [408, 429, 500, 502, 503, 504];

function isTransientError(
  status: number,
  retryableStatus: readonly number[],
): boolean {
  return retryableStatus.includes(status);
}

export class CrawlEngine {
  private readonly fetchImpl: CrawlFetch;
  private readonly userAgents: readonly string[];
  private readonly throttleMinMs: number;
  private readonly throttleMaxMs: number;
  private lastRequestAt = 0;
  private rotateIndex = 0;

  constructor(options: CrawlEngineOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetchImplFallback;
    this.userAgents = options.userAgents ?? DEFAULT_USER_AGENTS;
    this.throttleMinMs = options.throttleMinMs ?? 800;
    this.throttleMaxMs = options.throttleMaxMs ?? 1600;
  }

  nextUserAgent(): string {
    const ua = this.userAgents[this.rotateIndex % this.userAgents.length];
    this.rotateIndex += 1;
    return ua;
  }

  /** Sleep long enough to keep a human cadence between this engine's calls. */
  async pace(): Promise<void> {
    if (this.throttleMinMs <= 0) return;
    const sinceLast = Date.now() - this.lastRequestAt;
    const natural = randomInt(this.throttleMinMs, this.throttleMaxMs);
    const wait = Math.max(0, natural - sinceLast);
    if (wait > 0) await sleep(wait);
  }

  /**
   * Perform one HTTP call with humanized pacing, adaptive per-call backoff
   * across attempts, and transient-error retry. Never throws at the caller:
   * returns a result with `ok:false` and the last status/text on exhaustion.
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
      };
    }

    const headers: Record<string, string> = {
      "user-agent": this.nextUserAgent(),
      accept:
        "text/html,application/json,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-GB,en;q=0.9,en-US;q=0.8",
      ...options.headers,
    };

    const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    const baseBackoffMs = options.baseBackoffMs ?? 1500;
    const retryableStatus = options.retryableStatus ?? RETRYABLE_STATUS;
    const thinkTime = options.thinkTimeMs;

    let lastStatus = 0;
    let lastText = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (options.signal?.aborted) break;
      await this.pace();
      this.lastRequestAt = Date.now();

      const started = Date.now();
      let data: unknown;
      let text = "";
      let status = 0;

      try {
        const response = await this.fetchImpl(options.url, {
          method: options.method ?? "GET",
          headers,
          body:
            options.method && options.body !== undefined
              ? options.body
              : undefined,
          signal: options.signal,
        });
        status = response.status;
        lastStatus = status;
        text = await response.text();
        lastText = text;
        const contentType = response.headers.get("content-type") ?? "";
        data = parseBody(text, contentType);
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

      const retryable =
        status === 0 || isTransientError(status, retryableStatus);
      const lastAttempt = attempt >= maxAttempts;

      if (!retryable || lastAttempt) {
        // Human-like quiet pause between attempts models a user re-trying.
        if (thinkTime && thinkTime.min > 0) {
          await sleep(randomInt(thinkTime.min, thinkTime.max));
        }
        return {
          ok: status >= 200 && status < 400,
          status,
          data,
          text,
          attempt,
          elapsedMs,
        };
      }

      // Exponential backoff with full jitter: backoff * rand(0, 2^attempt).
      const backoff = baseBackoffMs * 2 ** (attempt - 1);
      const jittered = Math.floor(backoff * Math.random());
      await sleep(jittered);
    }

    return {
      ok: false,
      status: lastStatus,
      data: undefined,
      text: lastText,
      attempt: maxAttempts,
      elapsedMs: 0,
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
