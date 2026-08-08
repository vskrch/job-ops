import { CrawlEngine } from "@shared/crawl/engine.js";
import type { ExtractorSourceId } from "@shared/extractors";
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
}

export interface JobBoardsResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
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
          } else {
            failures.push(`${site.label}: ${rendered.text}`);
          }
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
