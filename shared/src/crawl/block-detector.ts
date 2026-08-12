/**
 * Block / CAPTCHA detection for the crawl engine.
 *
 * Many anti-bot systems return HTTP 200 with a challenge page instead of an
 * honest 403/429. `detectBlock` classifies a fetched body so the engine can
 * escalate to the next backend (e.g. Crawl4AI / Jina) instead of parsing a
 * CAPTCHA as if it were job content.
 *
 * Purely heuristic — no LLM call. The LLM integration already happens at the
 * job-parsing layer; we don't want LLM cost at the transport layer.
 */

export type BlockSignal = "ok" | "blocked" | "captcha" | "uncertain";

/** Strings that strongly indicate a challenge / block page (case-insensitive). */
const CHALLENGE_PATTERNS: readonly string[] = [
  "cf-challenge",
  "cf-chl-bypass",
  "cf-mitigated",
  "cf-ray",
  "cf-turnstile",
  "challenges.cloudflare.com",
  "hcaptcha",
  "recaptcha",
  "g-recaptcha",
  "access denied",
  "you have been blocked",
  "bot detected",
  "enable javascript and cookies",
  "just a moment",
  "captcha-bypass",
  "px-captcha",
  "_pxhd",
  "datadome",
  "verify you are human",
  "checking your browser",
  "_abck",
  "bm_sz",
  "incap_ses",
  "visid_incap",
  "reese84",
  "awswaf",
  "kdjio",
];

const CLOUDFLARE_CONTEXT_INDICATORS: readonly string[] = [
  "cf-ray",
  "cf-mitigated",
  "just a moment",
  "checking your browser",
];

const STATUS_BLOCKED = new Set([401, 403, 429, 451]);

function looksLikeHtml(contentType: string, text: string): boolean {
  if (contentType.includes("html")) return true;
  if (contentType.includes("json")) return false;
  return text.trimStart().startsWith("<");
}

/**
 * Classify a fetched response. Synchronous, zero-cost, never throws.
 *
 * - 401/403/429/451 → `"blocked"`
 * - 2xx HTML matching a known challenge string → `"blocked"` (or `"captcha"`
 *   when the pattern is captcha-specific)
 * - 2xx non-HTML (JSON/text/markdown) → `"ok"`
 * - 2xx tiny HTML body (<500 chars) with no real content → `"uncertain"`
 */
export function detectBlock(args: {
  status: number;
  contentType: string;
  text: string;
}): BlockSignal {
  const { status, contentType, text } = args;
  if (STATUS_BLOCKED.has(status)) return "blocked";
  if (status >= 200 && status < 300) {
    if (!looksLikeHtml(contentType, text)) return "ok";
    const lower = text.slice(0, 4000).toLowerCase();
    for (const pattern of CHALLENGE_PATTERNS) {
      if (lower.includes(pattern)) {
        return pattern.includes("captcha") || lower.includes("captcha")
          ? "captcha"
          : "blocked";
      }
    }
    if (lower.includes("cloudflare")) {
      const fullLower = text.toLowerCase();
      if (CLOUDFLARE_CONTEXT_INDICATORS.some((p) => fullLower.includes(p))) {
        return "blocked";
      }
    }
    // A 2xx HTML body that is suspiciously tiny with no real content is a
    // common CAPTCHA shell — flag it so callers can verify.
    if (text.trim().length < 500 && /<title/i.test(text) === false) {
      return "uncertain";
    }
    return "ok";
  }
  return "ok";
}

/** True when a signal should be treated as a hard block (escalate). */
export function isBlockSignal(signal: BlockSignal): boolean {
  return signal === "blocked" || signal === "captcha";
}
