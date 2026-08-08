/**
 * Organic header synthesis for the crawl engine.
 *
 * Generates a realistic `Referer` and `sec-fetch-*` header set per request
 * consistent with a real browser navigating to the target URL. Purely
 * deterministic — no LLM cost, no caching needed.
 *
 * - First visit to a domain: `Referer: https://www.google.com/`,
 *   `sec-fetch-site: cross-site` (arrived from a search engine).
 * - Subsequent visit to the same domain: `sec-fetch-site: same-origin`
 *   (navigated within the site), no external referer.
 * - `DNT: 1` is added on ~30% of requests to mimic privacy-conscious users.
 */

import type { BrowserFingerprint } from "./fingerprints.js";
import { DEFAULT_ACCEPT_LANGUAGE } from "./fingerprints.js";

const visitedDomains = new Set<string>();

function domainFromUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

export function buildOrganicHeaders(
  url: string,
  fingerprint: BrowserFingerprint,
): Record<string, string> {
  const domain = domainFromUrl(url);
  const isSubsequent = domain !== "" && visitedDomains.has(domain);
  if (domain !== "") visitedDomains.add(domain);

  const headers: Record<string, string> = {
    "accept-language": fingerprint.acceptLanguage || DEFAULT_ACCEPT_LANGUAGE,
    "sec-fetch-dest": "document",
    "sec-fetch-mode": "navigate",
    "sec-fetch-user": "?1",
  };

  if (isSubsequent) {
    // Arrived via in-site navigation, not a search engine.
    headers["sec-fetch-site"] = "same-origin";
  } else {
    headers["sec-fetch-site"] = "cross-site";
    headers.referer = "https://www.google.com/";
  }

  // ponytail: deterministic-ish privacy flag; ~30% of requests carry DNT.
  if (Math.random() < 0.3) {
    headers.dnt = "1";
  }

  return headers;
}

/** Test-only: reset the visited-domain memory so `same-origin` logic is deterministic. */
export function __resetOrganicHeadersStateForTests(): void {
  visitedDomains.clear();
}
