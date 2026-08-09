import type { CreateJobInput } from "@shared/types/jobs";

const HASJOB_ORIGIN = "https://hasjob.co";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DEFAULT_MAX_JOBS = 50;
const MAX_PAGES = 5;
const CARD_RE = /<a class="stickie"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;

export interface HasjobProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunHasjobOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  onProgress?: (event: HasjobProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface HasjobResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

function clean(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstGroup(content: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(content);
  return match?.[1];
}

function parseDate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = /(\d+)\s*(d|h|w)\s*([’']\d{2})?/i.exec(text);
  if (!match) return undefined;
  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2].toLowerCase();
  const ms =
    unit === "d"
      ? amount * 24 * 60 * 60 * 1000
      : unit === "h"
        ? amount * 60 * 60 * 1000
        : amount * 7 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

export async function runHasjob(
  options: RunHasjobOptions = {},
): Promise<HasjobResult> {
  const {
    searchTerms = ["software engineer"],
    maxJobsPerTerm = DEFAULT_MAX_JOBS,
    onProgress,
    shouldCancel,
    fetchImpl = fetch,
  } = options;

  const jobs: CreateJobInput[] = [];
  const seen = new Set<string>();
  const termErrors: string[] = [];

  for (let termIndex = 0; termIndex < searchTerms.length; termIndex++) {
    if (shouldCancel?.()) break;
    const searchTerm = searchTerms[termIndex] ?? "";
    onProgress?.({
      type: "term_start",
      termIndex: termIndex + 1,
      termTotal: searchTerms.length,
      searchTerm,
    });

    let termJobs = 0;
    let termError: string | undefined;

    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        if (shouldCancel?.()) break;
        if (termJobs >= maxJobsPerTerm) break;

        const params = new URLSearchParams({ q: searchTerm });
        if (page > 1) params.set("page", String(page));
        const url = `${HASJOB_ORIGIN}/?${params.toString()}`;

        const response = await fetchImpl(url, {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "accept-language": "en-US,en;q=0.9",
            "user-agent": USER_AGENT,
          },
        });
        if (!response.ok) {
          termError = `Hasjob returned HTTP ${response.status}`;
          break;
        }
        const body = await response.text();

        let pageJobs = 0;
        for (const match of body.matchAll(CARD_RE)) {
          const href = match[1];
          const card = match[2];
          if (termJobs >= maxJobsPerTerm) break;
          if (!href) continue;

          const jobUrl = new URL(href, HASJOB_ORIGIN).toString();
          const title = firstGroup(
            card,
            /<span class="headline">([\s\S]*?)<\/span>/,
          );
          const company = firstGroup(
            card,
            /<span class="annotation company-name">([\s\S]*?)<\/span>/,
          );
          const location = firstGroup(
            card,
            /<span class="annotation top-left">([\s\S]*?)<\/span>/,
          );
          const dateText = firstGroup(
            card,
            /<span class="annotation top-right">([\s\S]*?)<\/span>/,
          );

          if (!title || seen.has(jobUrl)) continue;
          seen.add(jobUrl);
          jobs.push({
            source: "hasjob",
            title: clean(title),
            employer: company ? clean(company) : "Unknown Employer",
            jobUrl,
            applicationLink: jobUrl,
            location: location ? clean(location) : undefined,
            isRemote: /remote|anywhere/i.test(card),
            datePosted: parseDate(dateText),
          });
          termJobs += 1;
          pageJobs += 1;
        }
        if (pageJobs === 0) break;
      }
    } catch (error) {
      termError = error instanceof Error ? error.message : String(error);
    }

    if (termError) {
      termErrors.push(`"${searchTerm}": ${termError}`);
    }
    onProgress?.({
      type: "term_complete",
      termIndex: termIndex + 1,
      termTotal: searchTerms.length,
      searchTerm,
      jobsFoundTerm: termJobs,
    });
  }

  if (termErrors.length > 0 && jobs.length === 0) {
    return { success: false, jobs, error: termErrors.join("; ") };
  }
  if (termErrors.length > 0) {
    return { success: true, jobs, error: termErrors.join("; ") };
  }
  return { success: true, jobs };
}
