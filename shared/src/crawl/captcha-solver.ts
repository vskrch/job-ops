/**
 * CAPTCHA solving integration for the crawl engine.
 *
 * Supports two services:
 *   - 2Captcha  (https://2captcha.com)
 *   - CapSolver (https://www.capsolver.com)
 *
 * `detectCaptcha` extracts the captcha type and sitekey from an HTML
 * challenge page. `solveCaptcha` submits the captcha to the configured
 * service and polls for a solution token. Never throws — every failure
 * degrades to `{ ok: false, error }` so the engine can escalate.
 *
 * The API key is never logged or included in error messages.
 */

export type CaptchaService = "2captcha" | "capsolver";

export type CaptchaType =
  | "recaptcha_v2"
  | "recaptcha_v3"
  | "hcaptcha"
  | "turnstile"
  | "funcaptcha";

export interface CaptchaSolverConfig {
  service: CaptchaService;
  apiKey: string;
  /** Max time to wait for a solution (ms, default 120_000). */
  timeoutMs?: number;
  /** Poll interval (ms, default 5_000). */
  pollingIntervalMs?: number;
}

export interface DetectedCaptcha {
  type: CaptchaType;
  sitekey: string;
  /** reCAPTCHA v3 action (optional). */
  action?: string;
}

export interface CaptchaSolution {
  ok: boolean;
  token?: string;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_POLLING_MS = 5_000;

// ─── Detection ───────────────────────────────────────────────────

/**
 * Detect the captcha type and sitekey from an HTML page.
 * Returns `null` when no known captcha is found.
 */
export function detectCaptcha(html: string): DetectedCaptcha | null {
  // Cloudflare Turnstile
  const turnstileMatch = html.match(
    /cf-turnstile[^>]*data-sitekey=["']([^"']+)["']/i,
  );
  if (turnstileMatch?.[1]) {
    return { type: "turnstile", sitekey: turnstileMatch[1] };
  }

  // reCAPTCHA v2 / v3
  const recaptchaMatch = html.match(
    /g-recaptcha[^>]*data-sitekey=["']([^"']+)["']/i,
  );
  if (recaptchaMatch?.[1]) {
    const actionMatch = html.match(
      /grecaptcha\.(?:execute|render)\([^)]*action["':\s]+["']([^"']+)["']/i,
    );
    return {
      type: actionMatch?.[1] ? "recaptcha_v3" : "recaptcha_v2",
      sitekey: recaptchaMatch[1],
      action: actionMatch?.[1],
    };
  }

  // hCaptcha
  const hcaptchaMatch = html.match(
    /h-captcha[^>]*data-sitekey=["']([^"']+)["']/i,
  );
  if (hcaptchaMatch?.[1]) {
    return { type: "hcaptcha", sitekey: hcaptchaMatch[1] };
  }

  // FunCaptcha / Arkose Labs (public key)
  const funcaptchaMatch = html.match(
    /funcaptcha[^>]*data-public-key=["']([^"']+)["']/i,
  );
  if (funcaptchaMatch?.[1]) {
    return { type: "funcaptcha", sitekey: funcaptchaMatch[1] };
  }

  // Arkose Labs enrichment
  const arkoseMatch = html.match(
    /arkoselabs[^>]*data-public-key=["']([^"']+)["']/i,
  );
  if (arkoseMatch?.[1]) {
    return { type: "funcaptcha", sitekey: arkoseMatch[1] };
  }

  return null;
}

// ─── 2Captcha ────────────────────────────────────────────────────

const TWOCAPTCHA_METHOD: Record<CaptchaType, string> = {
  recaptcha_v2: "userrecaptcha",
  recaptcha_v3: "userrecaptcha",
  hcaptcha: "hcaptcha",
  turnstile: "turnstile",
  funcaptcha: "funcaptcha",
};

async function solve2Captcha(
  config: CaptchaSolverConfig,
  captcha: DetectedCaptcha,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<CaptchaSolution> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollingMs = config.pollingIntervalMs ?? DEFAULT_POLLING_MS;
  const deadline = Date.now() + timeoutMs;
  const base = "https://2captcha.com";

  const params = new URLSearchParams({
    key: config.apiKey,
    method: TWOCAPTCHA_METHOD[captcha.type],
    googlekey: captcha.sitekey,
    pageurl: pageUrl,
    json: "1",
  });
  if (captcha.action) params.set("action", captcha.action);

  try {
    const submitResp = await fetch(`${base}/in.php?${params.toString()}`, {
      signal,
    });
    const submit = (await submitResp.json()) as {
      status: number;
      request: string;
    };

    if (submit.status !== 1) {
      return {
        ok: false,
        error: `2Captcha rejected: ${submit.request.slice(0, 80)}`,
      };
    }

    const captchaId = submit.request;

    while (Date.now() < deadline) {
      if (signal?.aborted) return { ok: false, error: "Aborted" };
      await sleep(pollingMs);
      if (signal?.aborted) return { ok: false, error: "Aborted" };

      const pollResp = await fetch(
        `${base}/res.php?key=${config.apiKey}&action=get&id=${captchaId}&json=1`,
        { signal },
      );
      const poll = (await pollResp.json()) as {
        status: number;
        request: string;
      };

      if (poll.status === 1) {
        return { ok: true, token: poll.request };
      }
      if (poll.request !== "CAPCHA_NOT_READY") {
        return {
          ok: false,
          error: `2Captcha error: ${poll.request.slice(0, 80)}`,
        };
      }
    }

    return { ok: false, error: "2Captcha timed out" };
  } catch (error) {
    if (signal?.aborted) return { ok: false, error: "Aborted" };
    return {
      ok: false,
      error: error instanceof Error ? error.message : "2Captcha request failed",
    };
  }
}

// ─── CapSolver ───────────────────────────────────────────────────

const CAPSOLVER_TYPE: Record<CaptchaType, string> = {
  recaptcha_v2: "ReCaptchaV2TaskProxyLess",
  recaptcha_v3: "ReCaptchaV3TaskProxyLess",
  hcaptcha: "HCaptchaTaskProxyLess",
  turnstile: "AntiTurnstileTaskProxyLess",
  funcaptcha: "FunCaptchaTaskProxyLess",
};

async function solveCapSolver(
  config: CaptchaSolverConfig,
  captcha: DetectedCaptcha,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<CaptchaSolution> {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollingMs = config.pollingIntervalMs ?? DEFAULT_POLLING_MS;
  const deadline = Date.now() + timeoutMs;
  const base = "https://api.capsolver.com";

  const task: Record<string, unknown> = {
    type: CAPSOLVER_TYPE[captcha.type],
    websiteURL: pageUrl,
    websiteKey: captcha.sitekey,
  };
  if (captcha.type === "recaptcha_v3" && captcha.action) {
    task.pageAction = captcha.action;
  }

  try {
    const submitResp = await fetch(`${base}/createTask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientKey: config.apiKey, task }),
      signal,
    });
    const submit = (await submitResp.json()) as {
      errorId: number;
      taskId?: string;
      errorCode?: string;
    };

    if (submit.errorId !== 0 || !submit.taskId) {
      return {
        ok: false,
        error: `CapSolver rejected: ${submit.errorCode ?? "unknown"}`,
      };
    }

    const taskId = submit.taskId;

    while (Date.now() < deadline) {
      if (signal?.aborted) return { ok: false, error: "Aborted" };
      await sleep(pollingMs);
      if (signal?.aborted) return { ok: false, error: "Aborted" };

      const pollResp = await fetch(`${base}/getTaskResult`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clientKey: config.apiKey, taskId }),
        signal,
      });
      const poll = (await pollResp.json()) as {
        errorId: number;
        status: string;
        solution?: Record<string, unknown>;
        errorCode?: string;
      };

      if (poll.errorId !== 0) {
        return {
          ok: false,
          error: `CapSolver error: ${poll.errorCode ?? "unknown"}`,
        };
      }
      if (poll.status === "ready" && poll.solution) {
        const token =
          (poll.solution.gRecaptchaResponse as string | undefined) ??
          (poll.solution.token as string | undefined);
        if (token) return { ok: true, token };
        return { ok: false, error: "CapSolver returned empty solution" };
      }
    }

    return { ok: false, error: "CapSolver timed out" };
  } catch (error) {
    if (signal?.aborted) return { ok: false, error: "Aborted" };
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "CapSolver request failed",
    };
  }
}

// ─── Public API ──────────────────────────────────────────────────

export async function solveCaptcha(
  config: CaptchaSolverConfig,
  captcha: DetectedCaptcha,
  pageUrl: string,
  signal?: AbortSignal,
): Promise<CaptchaSolution> {
  if (config.service === "capsolver") {
    return solveCapSolver(config, captcha, pageUrl, signal);
  }
  return solve2Captcha(config, captcha, pageUrl, signal);
}

export function getCaptchaSolverConfig(): CaptchaSolverConfig | null {
  const apiKey = process.env.CAPTCHA_SOLVER_API_KEY?.trim();
  if (!apiKey) return null;
  const service = (process.env.CAPTCHA_SOLVER_SERVICE?.trim() ??
    "2captcha") as CaptchaService;
  return {
    service: service === "capsolver" ? "capsolver" : "2captcha",
    apiKey,
    timeoutMs: parsePositiveInt(
      process.env.CAPTCHA_SOLVER_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
    ),
    pollingIntervalMs: parsePositiveInt(
      process.env.CAPTCHA_SOLVER_POLLING_MS,
      DEFAULT_POLLING_MS,
    ),
  };
}

/** Token form field name for a given captcha type. */
export function captchaTokenField(type: CaptchaType): string {
  switch (type) {
    case "hcaptcha":
      return "h-captcha-response";
    case "turnstile":
      return "cf-turnstile-response";
    default:
      return "g-recaptcha-response";
  }
}

// ─── Helpers ─────────────────────────────────────────────────────

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}
