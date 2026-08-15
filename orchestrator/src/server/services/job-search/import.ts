/**
 * Import search results into the tracked jobs table (ADR-008 SE-012).
 *
 * Maps JobSearchResultItem jobs to the `jobs` table with status "discovered"
 * and the search ID as the discoveredByRunId. Deduplicates against existing
 * jobs by normalized URL before inserting.
 */

import { logger } from "@infra/logger";
import * as jobSearchRepo from "@server/repositories/job-search";
import * as jobsRepo from "@server/repositories/jobs";
import type { CreateJobInput, JobSearchResultItem } from "@shared/types";

export interface ImportSearchJobsOptions {
  /** Import mode: all results, selected URLs, or above a relevance threshold. */
  mode: "all" | "selected" | "above_threshold";
  /** Required when mode is "selected". */
  jobUrls?: string[];
  /** Minimum relevance score for "above_threshold" mode (default 70). */
  minRelevance?: number;
}

export interface ImportSearchJobsResult {
  imported: number;
  skipped: number;
  duplicates: number;
}

/**
 * Import jobs from a completed search into the tracked `jobs` table.
 */
export async function importSearchJobsToTracked(
  searchId: string,
  options: ImportSearchJobsOptions,
): Promise<ImportSearchJobsResult> {
  const search = await jobSearchRepo.getJobSearch(searchId);
  if (!search || !search.results) {
    logger.warn("Import: search not found or has no results", { searchId });
    return { imported: 0, skipped: 0, duplicates: 0 };
  }

  const allJobs: JobSearchResultItem[] = search.results.jobs ?? [];
  if (allJobs.length === 0) {
    return { imported: 0, skipped: 0, duplicates: 0 };
  }

  // Select jobs based on mode.
  let selectedJobs: JobSearchResultItem[];
  switch (options.mode) {
    case "selected": {
      const urlSet = new Set(options.jobUrls ?? []);
      selectedJobs = allJobs.filter((item) => urlSet.has(item.job.jobUrl));
      break;
    }
    case "above_threshold": {
      const minScore = options.minRelevance ?? 70;
      selectedJobs = allJobs.filter((item) => item.relevanceScore >= minScore);
      break;
    }
    default:
      selectedJobs = allJobs;
      break;
  }

  if (selectedJobs.length === 0) {
    return { imported: 0, skipped: 0, duplicates: 0 };
  }

  // Convert to CreateJobInput array.
  const jobInputs: CreateJobInput[] = selectedJobs.map((item) => ({
    ...item.job,
    // Ensure discoveredByRunId is set to the search ID.
    discoveredByRunId: searchId,
  }));

  // Use the existing createJobs batch function which handles URL-based dedup.
  const result = await jobsRepo.createJobs(jobInputs, {
    discoveredByRunId: searchId,
  });

  logger.info("Imported search jobs to tracked", {
    searchId,
    mode: options.mode,
    selected: selectedJobs.length,
    imported: result.created,
    skipped: result.skipped,
  });

  return {
    imported: result.created,
    skipped: selectedJobs.length - result.created - result.skipped,
    duplicates: result.skipped,
  };
}
