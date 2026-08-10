import type { Crawl4AIConfig } from "@shared/crawl/crawl4ai-backend.js";
import { CrawlEngine, type CrawlRequestResult } from "@shared/crawl/engine.js";
import {
  extractJsonLdJobPostings,
  isHtmlText,
  type JsonLdJobPosting,
} from "@shared/crawl/structured.js";
import type { ExtractorSourceId } from "@shared/extractors";
import type { LlmClientConfig } from "@shared/llm/chat.js";
import {
  llmDetailPagesLimit,
  llmExtractDescription,
  llmJobsConfigured,
  llmParseJobs,
} from "@shared/llm/job-parser.js";
import type { CreateJobInput } from "@shared/types/jobs";
import type { JobBoardSite } from "./sites.js";
import { JOB_BOARD_SITES, slug, uniqueJobs } from "./sites.js";

export type JobBoardsProgressEvent =
  | {
      type: "term_start";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
    }
  | {
      type: "page_fetched";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      pageNo: number;
      resultsOnPage: number;
      totalCollected: number;
    }
  | {
      type: "term_complete";
      termIndex: number;
      termTotal: number;
      searchTerm: string;
      jobsFoundTerm: number;
    };

export interface RunJobBoardsOptions {
  sources?: ExtractorSourceId[];
  searchTerms?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: JobBoardsProgressEvent) => void;
  shouldCancel?: () => boolean;
  /** UI/settings-provided LLM config; falls back to env vars. */
  llm?: LlmClientConfig;
  /** Behavioral pacing profile (default `normal` when an LLM is configured). */
  behaviorProfile?: "fast" | "normal" | "cautious" | "stealth";
}

export interface JobBoardsResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

function truncate(value: string, max = 200): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/** Read Crawl4AI server config from env; returns undefined when unconfigured. */
function readCrawl4aiConfig(): Crawl4AIConfig | undefined {
  const baseUrl = process.env.CRAWL4AI_BASE_URL?.trim();
  if (!baseUrl) return undefined;
  return {
    baseUrl,
    apiToken: process.env.CRAWL4AI_API_TOKEN?.trim() || undefined,
    undetectedBrowser: process.env.CRAWL4AI_UNDETECTED?.trim() === "true",
  };
}

/** Map a JSON-LD JobPosting to a normalized job input. */
function jobFromPosting(args: {
  source: ExtractorSourceId;
  posting: JsonLdJobPosting;
  fallbackUrl: string;
}): CreateJobInput | null {
  const { source, posting, fallbackUrl } = args;
  const title = posting.title?.trim();
  if (!title) return null;
  const jobUrl = posting.url?.trim() || fallbackUrl;
  const employer = posting.employer?.trim() || "Unknown Employer";
  return {
    source,
    sourceJobId: slug(jobUrl) || slug(`${employer}-${title}`),
    title,
    employer,
    jobUrl,
    applicationLink: jobUrl,
    location: posting.location,
    salary: posting.salary,
    jobType: posting.employmentType,
    datePosted: posting.datePosted,
    jobDescription: posting.description?.trim() || undefined,
  };
}

/** Parse a fetched body: JSON-LD first for HTML, then the site's regex. */
function parseFetched(
  source: ExtractorSourceId,
  site: JobBoardSite,
  result: CrawlRequestResult,
): CreateJobInput[] {
  if (!isHtmlText(result.text, result.contentType)) {
    return site.parse(result.text);
  }
  const structured = extractJsonLdJobPostings(result.text)
    .map((posting) =>
      jobFromPosting({ source, posting, fallbackUrl: site.searchUrl("") }),
    )
    .filter((job): job is CreateJobInput => job !== null);
  return uniqueJobs([...structured, ...site.parse(result.text)]);
}

/**
 * Fetch up to `limit` detail pages and extract descriptions: JSON-LD when the
 * page embeds it (zero LLM cost), otherwise LLM extraction. Jobs whose detail
 * fetch or extraction fails are returned unchanged (lights on).
 */
async function fetchDescriptions(
  engine: CrawlEngine,
  jobs: CreateJobInput[],
  llm?: LlmClientConfig,
): Promise<CreateJobInput[]> {
  const out: CreateJobInput[] = [];
  for (const job of jobs) {
    try {
      const detail = await engine.request({
        url: job.jobUrl,
        backends: ["direct", "jina"],
        maxAttempts: 2,
        thinkTimeMs: { min: 1200, max: 2600 },
      });
      if (detail.ok) {
        if (isHtmlText(detail.text, detail.contentType)) {
          const postings = extractJsonLdJobPostings(detail.text);
          const description = postings.find(
            (posting) => posting.description,
          )?.description;
          if (description) {
            out.push({ ...job, jobDescription: description });
            continue;
          }
        }
        const extracted = await llmExtractDescription({
          jobUrl: job.jobUrl,
          title: job.title,
          employer: job.employer,
          pageText: detail.text,
          llm,
        });
        if (extracted.success) {
          out.push({ ...job, jobDescription: extracted.description });
          continue;
        }
      }
    } catch {
      // Fall through to unchanged job.
    }
    out.push(job);
  }
  return out;
}

export async function runJobBoards(
  options: RunJobBoardsOptions = {},
): Promise<JobBoardsResult> {
  const sources = options.sources?.filter((s) => JOB_BOARD_SITES[s]) ?? [];
  const searchTerms =
    options.searchTerms && options.searchTerms.length > 0
      ? options.searchTerms
      : ["web developer"];
  const maxJobsPerTerm = Math.max(1, options.maxJobsPerTerm ?? 200);
  const termTotal = sources.length * searchTerms.length;
  const behaviorProfile =
    options.behaviorProfile ??
    (llmJobsConfigured(options.llm) ? "normal" : "fast");
  const crawl4aiConfig = readCrawl4aiConfig();
  const engine = new CrawlEngine({
    behaviorProfile,
    crawl4ai: crawl4aiConfig,
  });
  // Escalate direct → crawl4ai (browser) → jina when Crawl4AI is configured.
  const backends = crawl4aiConfig
    ? (["direct", "crawl4ai", "jina"] as const)
    : (["direct", "jina"] as const);

  const jobs: CreateJobInput[] = [];
  const failures: string[] = [];
  let termIndex = 0;

  for (const source of sources) {
    const site = JOB_BOARD_SITES[source];
    for (const searchTerm of searchTerms) {
      if (options.shouldCancel?.()) break;
      termIndex += 1;
      options.onProgress?.({
        type: "term_start",
        termIndex,
        termTotal,
        searchTerm,
      });

      let collected = 0;
      let parsed: CreateJobInput[] = [];
      let fetchedText = "";
      try {
        // Escalation: direct → crawl4ai (browser) → jina, tried in order by
        // the engine. A 200-OK challenge page is detected and skipped.
        const direct = await engine.request({
          url: site.searchUrl(searchTerm),
          backends,
          maxAttempts: 2,
          thinkTimeMs: { min: 1200, max: 2600 },
        });

        if (direct.ok) {
          parsed = parseFetched(source, site, direct);
          fetchedText = direct.text;
        }
        // SPA boards return a 200 shell with zero jobs; fetch a browser- or
        // Jina-rendered version before giving up.
        if (parsed.length === 0) {
          const rendered = await engine.request({
            url: site.searchUrl(searchTerm),
            backends: crawl4aiConfig ? ["crawl4ai", "jina"] : ["jina"],
            maxAttempts: 2,
            thinkTimeMs: { min: 1200, max: 2600 },
          });
          if (rendered.ok) {
            parsed = parseFetched(source, site, rendered);
            fetchedText = rendered.text;
          } else {
            failures.push(`${site.label}: ${truncate(rendered.text)}`);
          }
        }

        // LLM pass: structured extraction with descriptions, falling back to
        // the regex results whenever the LLM is unavailable or fails.
        if (llmJobsConfigured(options.llm) && fetchedText.length > 0) {
          const llmJobs = await llmParseJobs({
            source,
            searchTerm,
            pageText: fetchedText,
            maxJobs: maxJobsPerTerm,
            llm: options.llm,
          });
          if (llmJobs && llmJobs.length > 0) parsed = llmJobs;
        }

        // Description pass: fetch detail pages for jobs missing a
        // description and LLM-extract it (capped per term).
        const detailLimit = llmDetailPagesLimit();
        if (
          llmJobsConfigured(options.llm) &&
          detailLimit > 0 &&
          parsed.some((job) => !job.jobDescription)
        ) {
          const detailJobs = await fetchDescriptions(
            engine,
            parsed.filter((job) => !job.jobDescription).slice(0, detailLimit),
            options.llm,
          );
          const byUrl = new Map(detailJobs.map((job) => [job.jobUrl, job]));
          parsed = parsed.map((job) => byUrl.get(job.jobUrl) ?? job);
        }

        for (const job of parsed) {
          if (collected >= maxJobsPerTerm) break;
          jobs.push(job);
          collected += 1;
        }
      } catch (error) {
        failures.push(
          `${site.label}: ${truncate(
            error instanceof Error ? error.message : "unknown error",
          )}`,
        );
      }

      options.onProgress?.({
        type: "page_fetched",
        termIndex,
        termTotal,
        searchTerm,
        pageNo: 1,
        resultsOnPage: collected,
        totalCollected: collected,
      });
      options.onProgress?.({
        type: "term_complete",
        termIndex,
        termTotal,
        searchTerm,
        jobsFoundTerm: collected,
      });
    }
  }

  if (failures.length === termTotal && termTotal > 0) {
    return {
      success: false,
      jobs: [],
      error: failures.join("; "),
    };
  }

  return { success: true, jobs };
}
