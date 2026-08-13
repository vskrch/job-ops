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

const MAX_VISITED_DOMAINS = 1000;

/**
 * Per-instance organic header builder.
 *
 * State (the visited-domains Set) lives on the instance so concurrent
 * engines don't pollute each other's referer decisions. Create one
 * `OrganicHeaders` per `CrawlEngine` and pass it into
 * `buildOrganicHeaders()` for every request.
 */
export class OrganicHeaders {
  private readonly visitedDomains = new Set<string>();

  private domainFromUrl(url: string): string {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  }

  build(url: string, fingerprint: BrowserFingerprint): Record<string, string> {
    const domain = this.domainFromUrl(url);
    const isSubsequent = domain !== "" && this.visitedDomains.has(domain);
    if (domain !== "") {
      if (this.visitedDomains.size >= MAX_VISITED_DOMAINS) {
        const first = this.visitedDomains.values().next().value;
        if (first !== undefined) this.visitedDomains.delete(first);
      }
      this.visitedDomains.add(domain);
    }

    const headers: Record<string, string> = {
      "accept-language": fingerprint.acceptLanguage || DEFAULT_ACCEPT_LANGUAGE,
      "sec-fetch-dest": "document",
      "sec-fetch-mode": "navigate",
      "sec-fetch-user": "?1",
    };

    if (isSubsequent) {
      headers["sec-fetch-site"] = "same-origin";
    } else {
      headers["sec-fetch-site"] = "cross-site";
      headers.referer = "https://www.google.com/";
    }

    if (Math.random() < 0.3) {
      headers.dnt = "1";
    }

    return headers;
  }
}

/**
 * @deprecated Use `new OrganicHeaders().build(url, fingerprint)` instead.
 * Kept for backward compatibility — this function uses a module-level
 * Set shared across all engines (causing cross-engine referer
 * contamination under concurrent load). Will be removed.
 */
export function buildOrganicHeaders(
  url: string,
  fingerprint: BrowserFingerprint,
): Record<string, string> {
  const headers = new OrganicHeaders();
  return headers.build(url, fingerprint);
}
