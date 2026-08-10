/**
 * Crawl4AI REST client — self-hosted headless-browser crawling backend.
 *
 * Crawl4AI (https://github.com/unclecode/crawl4ai) runs as a Docker container
 * exposing `POST /crawl`. It provides stealth mode, full JS rendering, and
 * clean markdown output — exactly what our LLM job parser consumes.
 *
 * The `/crawl` endpoint returns either:
 *   - a synchronous response with `results` inline, or
 *   - an async response with `task_id`, polled via `GET /task/{task_id}`.
 *
 * Never throws: every failure degrades to `{ ok: false, error }` so the engine
 * can escalate to the next backend (Jina).
 */

export interface Crawl4AIConfig {
  /** Base URL of the self-hosted Crawl4AI server (e.g., "http://localhost:11235"). */
  baseUrl: string;
  /** Optional JWT token for authenticated Crawl4AI servers (v0.9+ auth). */
  apiToken?: string;
  /** Enable stealth mode (default: true). */
  stealth?: boolean;
  /**
   * Use Crawl4AI's undetected-browser mode (v0.7.3+) which bypasses
   * Cloudflare, Akamai, and custom bot-detection systems. When true,
   * `browser_type: "undetected"` is sent instead of `enable_stealth`.
   * Default: false (stealth mode is used).
   */
  undetectedBrowser?: boolean;
  /** Request timeout in ms (default: 30000). */
  timeoutMs?: number;
}

export interface Crawl4AIResult {
  ok: boolean;
  markdown: string;
  html: string;
  fitMarkdown?: string;
  statusCode: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 1000;
const MAX_POLLS = 30;

interface CrawlResultItem {
  markdown?: unknown;
  html?: unknown;
  fit_markdown?: unknown;
  status_code?: unknown;
  metadata?: unknown;
}

interface CrawlResponse {
  results?: CrawlResultItem[];
  task_id?: string;
}

function asString(value: unknown): string {
  // Crawl4AI's markdown can be an object ({ raw_markdown, fit_markdown }) or a string.
  if (typeof value === "string") return value;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.raw_markdown === "string") return record.raw_markdown;
    if (typeof record.markdown === "string") return record.markdown;
  }
  return "";
}

/** Extract `fit_markdown` from a markdown value (object form) or a fit string. */
function asFitMarkdown(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.fit_markdown === "string") return record.fit_markdown;
  }
  if (typeof value === "string") return value;
  return undefined;
}

function normalizeResult(item: CrawlResultItem): Crawl4AIResult {
  const markdown = asString(item.markdown);
  return {
    ok: true,
    markdown,
    html: typeof item.html === "string" ? item.html : "",
    // Fit markdown comes from the markdown object's `fit_markdown` field or
    // a dedicated `fit_markdown` top-level field — never the full markdown.
    fitMarkdown:
      (item.markdown && typeof item.markdown === "object"
        ? asFitMarkdown(item.markdown)
        : undefined) ?? asFitMarkdown(item.fit_markdown),
    statusCode: typeof item.status_code === "number" ? item.status_code : 200,
    metadata:
      item.metadata && typeof item.metadata === "object"
        ? (item.metadata as Record<string, unknown>)
        : undefined,
  };
}

function authHeaders(config: Crawl4AIConfig): Record<string, string> {
  const token = config.apiToken?.trim();
  return token ? { authorization: `Bearer ${token}` } : {};
}

function buildRequestBody(url: string, config: Crawl4AIConfig) {
  const stealth = config.stealth ?? true;
  const useUndetected = config.undetectedBrowser === true;

  // When undetected-browser mode is enabled (Crawl4AI v0.7.3+), the
  // browser_type is set to "undetected" which bypasses Cloudflare/Akamai.
  // The stealth flag is redundant in this mode and omitted.
  const browserParams: Record<string, unknown> = {
    headless: true,
  };
  if (useUndetected) {
    browserParams.browser_type = "undetected";
    browserParams.extra_args = [
      "--disable-blink-features=AutomationControlled",
      "--disable-web-security",
    ];
  } else {
    browserParams.enable_stealth = stealth;
  }

  return {
    urls: [url],
    browser_config: {
      type: "BrowserConfig",
      params: browserParams,
    },
    crawler_run_config: {
      type: "CrawlerRunConfig",
      params: {
        wait_until: "networkidle",
        word_count_threshold: 10,
        bypass_cache: true,
      },
    },
  };
}

async function pollTask(
  baseUrl: string,
  taskId: string,
  headers: Record<string, string>,
  signal: AbortSignal | undefined,
): Promise<Crawl4AIResult> {
  for (let i = 0; i < MAX_POLLS; i += 1) {
    if (signal?.aborted) {
      return failure("Aborted");
    }
    await sleep(POLL_INTERVAL_MS);
    try {
      const response = await fetch(`${baseUrl}/task/${taskId}`, {
        method: "GET",
        headers,
        signal,
      });
      if (!response.ok) continue;
      const payload = (await response.json()) as CrawlResponse;
      if (payload.results && payload.results.length > 0) {
        return normalizeResult(payload.results[0]);
      }
      // Still pending; keep polling.
    } catch (error) {
      // Transient poll error; keep trying until the poll budget is exhausted.
      if (signal?.aborted) return failure("Aborted");
      void error;
    }
  }
  return failure("Crawl4AI task timed out");
}

function failure(error: string): Crawl4AIResult {
  return {
    ok: false,
    markdown: "",
    html: "",
    statusCode: 0,
    error,
  };
}

/**
 * Crawl a single URL via the Crawl4AI server. Handles both sync and async
 * (task_id polling) flows. Never throws.
 */
export async function crawl4aiFetch(
  url: string,
  config: Crawl4AIConfig,
  signal?: AbortSignal,
): Promise<Crawl4AIResult> {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...authHeaders(config),
  };

  try {
    const timeoutSignal =
      signal ?? (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined);
    const response = await fetch(`${baseUrl}/crawl`, {
      method: "POST",
      headers,
      body: JSON.stringify(buildRequestBody(url, config)),
      signal: timeoutSignal,
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 200);
      return failure(
        `Crawl4AI responded ${response.status}${detail ? `: ${detail}` : ""}`,
      );
    }

    const payload = (await response.json()) as CrawlResponse;

    // Synchronous flow: results inline.
    if (payload.results && payload.results.length > 0) {
      return normalizeResult(payload.results[0]);
    }

    // Async flow: poll the task until results arrive.
    if (payload.task_id) {
      return await pollTask(baseUrl, payload.task_id, headers, signal);
    }

    return failure("Crawl4AI returned no results and no task_id");
  } catch (error) {
    if (signal?.aborted) return failure("Aborted");
    const message = error instanceof Error ? error.message : "Network error";
    return failure(`Crawl4AI request failed: ${message}`);
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
