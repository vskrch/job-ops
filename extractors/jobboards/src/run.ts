import { CrawlEngine } from "@shared/crawl/engine.js";
import type { ExtractorSourceId } from "@shared/extractors";
import type { LlmClientConfig } from "@shared/llm/chat.js";
import {
  llmDetailPagesLimit,
  llmExtractDescription,
  llmJobsConfigured,
  llmParseJobs,
} from "@shared/llm/job-parser.js";
import type { CreateJobInput } from "@shared/types/jobs";
import { JOB_BOARD_SITES } from "./sites.js";

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
}

export interface JobBoardsResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

/**
 * Fetch up to `limit` detail pages and LLM-extract descriptions. Jobs whose
 * detail fetch or extraction fails are returned unchanged (lights on).
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
  const engine = new CrawlEngine();

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
      let fetchedText = "";
      try {
        // Direct fetch first; the engine falls back to Jina internally when
        // the site blocks us (403/429/5xx).
        const direct = await engine.request({
          url: site.searchUrl(searchTerm),
          backends: ["direct", "jina"],
          maxAttempts: 2,
          thinkTimeMs: { min: 1200, max: 2600 },
        });

        let parsed = direct.ok ? site.parse(direct.text) : [];
        fetchedText = direct.ok ? direct.text : "";
        // SPA boards return a 200 shell with zero jobs; fetch the Jina-
        // rendered version before giving up.
        if (parsed.length === 0) {
          const rendered = await engine.request({
            url: site.searchUrl(searchTerm),
            backends: ["jina"],
            maxAttempts: 2,
            thinkTimeMs: { min: 1200, max: 2600 },
          });
          if (rendered.ok) {
            parsed = site.parse(rendered.text);
            fetchedText = rendered.text;
          } else {
            failures.push(`${site.label}: ${rendered.text}`);
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
          `${site.label}: ${error instanceof Error ? error.message : "unknown error"}`,
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
