/**
 * DuckDuckGo Free Web Search Adapter (ADR-008).
 *
 * 100% free, zero-cost, unlimited search queries across the public internet.
 * Uses DuckDuckGo HTML / Lite endpoints to find live job postings on ATS platforms
 * (Greenhouse, Lever, Ashby, Workday, SmartRecruiters) and direct career sites.
 */

import { logger } from "@infra/logger";
import type { CreateJobInput } from "@shared/types";
import type { MetaSearchAdapter, MetaSearchParams } from "./types";

function buildDdgQuery(params: MetaSearchParams): string {
  const roleTerms =
    params.terms.length > 0
      ? params.terms.slice(0, 3).join(" OR ")
      : "software engineer";
  const locationPart =
    params.location.cities.length > 0
      ? params.location.cities[0]
      : params.location.country || "";

  const atsFilter =
    "(site:greenhouse.io OR site:lever.co OR site:jobs.ashbyhq.com OR site:workday.com OR site:smartrecruiters.com OR site:linkedin.com/jobs)";

  const modeFilter =
    params.workMode === "remote"
      ? "remote"
      : params.workMode === "hybrid"
        ? "hybrid"
        : "";

  return `(${roleTerms}) ${locationPart} ${modeFilter} ${atsFilter} "apply"`.trim();
}

function cleanHtml(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDdgResults(html: string): CreateJobInput[] {
  const jobs: CreateJobInput[] = [];
  // Regex to extract link snippets from DDG HTML response
  // DDG HTML links typically have class="result__url" and class="result__title"
  const resultBlocks = html.split(/class="result\s+/);

  for (const block of resultBlocks.slice(1)) {
    try {
      // Extract title and URL
      const titleMatch = block.match(
        /class="result__title"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i,
      );
      const snippetMatch = block.match(
        /class="result__snippet"[^>]*>([\s\S]*?)<\/a>|class="result__snippet"[^>]*>([\s\S]*?)<\/div>/i,
      );

      if (!titleMatch) continue;

      let rawUrl = titleMatch[1];
      // Decode DuckDuckGo redirect URL (/l/?kh=-1&uddg=https%3A%2F%2F...)
      if (rawUrl.includes("uddg=")) {
        const urlParams = new URL(rawUrl, "https://html.duckduckgo.com")
          .searchParams;
        const decoded = urlParams.get("uddg");
        if (decoded) rawUrl = decoded;
      }

      if (!rawUrl.startsWith("http")) continue;

      const rawTitle = cleanHtml(titleMatch[2]);
      const snippet = snippetMatch
        ? cleanHtml(snippetMatch[1] || snippetMatch[2] || "")
        : "";

      // Deduce employer and clean title
      // e.g. "Senior Software Engineer - Stripe - Lever" or "Backend Developer | Greenhouse"
      let employer = "Direct Employer";
      let title = rawTitle;

      if (rawTitle.includes(" - ")) {
        const parts = rawTitle.split(" - ");
        title = parts[0].trim();
        if (
          parts.length > 1 &&
          !parts[1].toLowerCase().includes("lever") &&
          !parts[1].toLowerCase().includes("greenhouse")
        ) {
          employer = parts[1].trim();
        }
      } else if (rawTitle.includes(" | ")) {
        const parts = rawTitle.split(" | ");
        title = parts[0].trim();
        if (parts.length > 1) {
          employer = parts[1].trim();
        }
      }

      // Infer source from URL
      let source: CreateJobInput["source"] = "manual";
      if (rawUrl.includes("greenhouse.io"))
        source = "greenhouse" as CreateJobInput["source"];
      else if (rawUrl.includes("lever.co"))
        source = "lever" as CreateJobInput["source"];
      else if (rawUrl.includes("ashbyhq.com"))
        source = "ashby" as CreateJobInput["source"];
      else if (rawUrl.includes("linkedin.com"))
        source = "linkedin" as CreateJobInput["source"];
      else if (rawUrl.includes("indeed.com"))
        source = "indeed" as CreateJobInput["source"];

      jobs.push({
        title,
        employer,
        jobUrl: rawUrl,
        location: snippet.toLowerCase().includes("remote")
          ? "Remote"
          : "Various Locations",
        source,
        jobDescription: snippet,
        isRemote:
          snippet.toLowerCase().includes("remote") ||
          rawTitle.toLowerCase().includes("remote"),
        applicationLink: rawUrl,
      });
    } catch {
      // skip unparseable block
    }
  }

  return jobs;
}

export const duckDuckGoAdapter: MetaSearchAdapter = {
  id: "free-duckduckgo",
  displayName: "Free Web Search (DuckDuckGo)",

  async available(): Promise<boolean> {
    // DuckDuckGo free search is always available with 0 API keys required
    return true;
  },

  async *search(params: MetaSearchParams): AsyncGenerator<CreateJobInput[]> {
    const query = buildDdgQuery(params);
    logger.info("Running free DuckDuckGo web search", { query });

    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        Math.min(params.timeoutMs, 25000),
      );

      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const response = await fetch(searchUrl, {
        method: "POST",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: `q=${encodeURIComponent(query)}&b=`,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        // Fallback to Jina reader public proxy for DuckDuckGo if rate limited
        logger.warn("DDG HTML search returned status, trying free mirror", {
          status: response.status,
        });
        const jinaUrl = `https://r.jina.ai/https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
        const jinaResp = await fetch(jinaUrl);
        if (jinaResp.ok) {
          const text = await jinaResp.text();
          const jobs = parseDdgResults(text);
          if (jobs.length > 0) {
            yield jobs;
            return;
          }
        }
        return;
      }

      const html = await response.text();
      const jobs = parseDdgResults(html);

      if (jobs.length > 0) {
        yield jobs;
      }
    } catch (error) {
      logger.warn("DuckDuckGo free search encountered non-fatal error", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },
};
