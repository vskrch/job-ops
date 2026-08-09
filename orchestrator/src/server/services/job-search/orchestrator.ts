/**
 * Job search orchestrator — the main search execution flow.
 *
 * 1. Parse NL query → structured spec (LLM)
 * 2. Aggregate jobs from all available sources (reuse extractor registry)
 * 3. Deduplicate across sources
 * 4. Strict filtering (deterministic)
 * 5. LLM relevance ranking
 * 6. Generate report
 * 7. Email delivery
 *
 * Follows the same single-flight lock pattern as pipeline/orchestrator.ts.
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { getExtractorRegistry } from "@server/extractors/registry";
import * as jobSearchRepo from "@server/repositories/job-search";
import * as settingsRepo from "@server/repositories/settings";
import { asyncPool } from "@server/utils/async-pool";
import { normalizeCountryKey } from "@shared/location-support.js";
import type {
  CreateJobInput,
  JobSearchResultItem,
  JobSearchResults,
  ParsedSearchSpec,
  SearchSourceStatus,
} from "@shared/types";
import { sendSearchResultsEmail } from "../email";
import { deduplicateJobs } from "./dedup";
import { computeFreshnessWindow, filterJobs } from "./filter";
import { clearSearchProgress, emitSearchProgress } from "./progress";
import { computeSearchHash, parseSearchQuery } from "./query-parser";
import { rankJobs } from "./ranking";

const SEARCH_CONCURRENCY = 3;

// Single-flight: prevent the same search from running twice.
const activeSearches = new Set<string>();

function getPublicBaseUrl(): string {
  return process.env.JOBOPS_PUBLIC_BASE_URL?.trim() || "http://localhost:3001";
}

/**
 * Resolve which sources to search based on the parsed spec.
 * Uses all available pipeline sources by default, filtered by country compatibility.
 */
async function resolveSources(
  _spec: ParsedSearchSpec,
): Promise<{ sources: string[]; availableSources: string[] }> {
  const registry = await getExtractorRegistry();
  const availableSources = [...registry.manifestBySource.keys()];

  // For now, search all available sources. The country compatibility check
  // happens inside each extractor via isSourceAllowedForCountry.
  return { sources: availableSources, availableSources };
}

/**
 * Run a single extractor source and return its results.
 */
async function runSource(
  source: string,
  spec: ParsedSearchSpec,
  existingJobUrls: Promise<string[]>,
): Promise<{ source: string; jobs: CreateJobInput[]; error: string | null }> {
  try {
    const registry = await getExtractorRegistry();
    const manifest = registry.manifestBySource.get(source as never);
    if (!manifest) {
      return { source, jobs: [], error: "Extractor manifest not registered" };
    }

    // Group sources by manifest — find all sources provided by this manifest.
    const manifestSources = [...registry.manifestBySource.entries()]
      .filter(([, m]) => m.id === manifest.id)
      .map(([s]) => s);

    const searchTerms: string[] = [
      ...(spec.roles.length > 0 ? spec.roles : []),
      ...(spec.roles.length === 0 && spec.skills.length > 0 ? spec.skills : []),
    ];
    if (searchTerms.length === 0) {
      searchTerms.push("software engineer");
    }

    const selectedCountry = spec.location.country
      ? normalizeCountryKey(spec.location.country)
      : "united kingdom";

    const settings = await settingsRepo.getAllSettings();
    const filteredSettings = Object.fromEntries(
      Object.entries(settings).filter(
        ([, value]) =>
          typeof value === "string" || typeof value === "undefined",
      ),
    ) as Record<string, string | undefined>;

    if (spec.postedWithin.value !== null) {
      const hours =
        spec.postedWithin.unit === "hours"
          ? spec.postedWithin.value
          : spec.postedWithin.unit === "days"
            ? spec.postedWithin.value * 24
            : spec.postedWithin.value * 24 * 7;
      filteredSettings.jobspyHoursOld = String(hours);
    }
    if (spec.workMode === "remote") {
      filteredSettings.jobspyIsRemote = "1";
    }

    const result = await manifest.run({
      source,
      selectedSources: manifestSources,
      settings: filteredSettings,
      searchTerms,
      selectedCountry,
      getExistingJobUrls: () => existingJobUrls,
      onProgress: () => {},
    });

    if (!result.success) {
      return {
        source,
        jobs: [],
        error: result.error ?? "Unknown extractor error",
      };
    }

    return { source, jobs: result.jobs, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn("Job search source failed", { source, error: message });
    return { source, jobs: [], error: message };
  }
}

/**
 * Execute a job search end-to-end.
 * This is the background task launched after the API creates the search record.
 */
export async function executeJobSearch(
  searchId: string,
  query: string,
): Promise<void> {
  if (activeSearches.has(searchId)) {
    logger.warn("Search already running, skipping", { searchId });
    return;
  }
  activeSearches.add(searchId);

  await runWithRequestContext({}, async () => {
    const searchLogger = logger.child({ searchId });
    searchLogger.info("Starting job search", { queryLength: query.length });

    try {
      // 1. Parse the query
      const parsedSpec = await parseSearchQuery(query);

      await jobSearchRepo.updateJobSearch(searchId, {
        status: "running",
      });

      // 2. Resolve sources
      const { sources } = await resolveSources(parsedSpec);

      emitSearchProgress({
        type: "started",
        searchId,
        parsedSpec,
        sourcesTotal: sources.length,
      });

      // 3. Aggregate jobs from all sources
      const sourceStatuses: SearchSourceStatus[] = sources.map((s) => ({
        source: s,
        status: "pending",
        jobsFound: 0,
        error: null,
      }));

      const existingJobUrlsPromise: Promise<string[]> = Promise.resolve([]);

      emitSearchProgress({
        type: "phase",
        searchId,
        phase: "aggregating",
        message: `Fetching jobs from ${sources.length} sources...`,
      });

      let sourcesCompleted = 0;
      const allJobs: CreateJobInput[] = [];

      const sourceResults = await asyncPool({
        items: sources,
        concurrency: SEARCH_CONCURRENCY,
        onTaskStarted: (source) => {
          emitSearchProgress({
            type: "source_started",
            searchId,
            source,
            sourcesCompleted,
            sourcesTotal: sources.length,
          });
        },
        onTaskSettled: () => {
          sourcesCompleted++;
        },
        task: async (source) => {
          const idx = sourceStatuses.findIndex((s) => s.source === source);
          if (idx >= 0) sourceStatuses[idx].status = "running";

          const result = await runSource(
            source,
            parsedSpec,
            existingJobUrlsPromise,
          );

          if (idx >= 0) {
            sourceStatuses[idx].status = result.error ? "failed" : "succeeded";
            sourceStatuses[idx].jobsFound = result.jobs.length;
            sourceStatuses[idx].error = result.error;
          }

          emitSearchProgress({
            type: "source_completed",
            searchId,
            source,
            sourcesCompleted,
            sourcesTotal: sources.length,
            jobsFound: result.jobs.length,
            status: result.error ? "failed" : "succeeded",
            error: result.error,
          });

          return result;
        },
      });

      for (const result of sourceResults) {
        allJobs.push(...result.jobs);
      }

      const sourcesSucceeded = sourceStatuses
        .filter((s) => s.status === "succeeded")
        .map((s) => s.source);
      const sourcesFailed = sourceStatuses
        .filter((s) => s.status === "failed")
        .map((s) => `${s.source}: ${s.error ?? "unknown error"}`);

      // 4. Deduplicate
      emitSearchProgress({
        type: "phase",
        searchId,
        phase: "deduplicating",
        message: `Deduplicating ${allJobs.length} jobs...`,
      });

      const dedupResult = deduplicateJobs(allJobs);

      // 5. Strict filtering
      emitSearchProgress({
        type: "phase",
        searchId,
        phase: "filtering",
        message: `Filtering ${dedupResult.jobs.length} jobs by strict criteria...`,
      });

      const filterInputs: CreateJobInput[] = dedupResult.jobs.map((j) => {
        const { sources: _sources, ...jobData } = j;
        return jobData;
      });

      const filterResults = filterJobs(filterInputs, parsedSpec);

      // Track freshness filtering: count jobs that failed specifically due to postedWithin.
      const removedByFreshness = parsedSpec.postedWithin.value
        ? filterResults.filter(
            (r) => !r.passed && r.filterReason?.includes("postedWithin"),
          ).length
        : 0;

      const freshness = computeFreshnessWindow(parsedSpec, removedByFreshness);

      // 6. Rank
      emitSearchProgress({
        type: "phase",
        searchId,
        phase: "ranking",
        message: "Ranking jobs by relevance...",
        counts: {
          discovered: allJobs.length,
          afterFilter: filterResults.filter((r) => r.passed).length,
          duplicatesRemoved: dedupResult.duplicatesRemoved,
        },
      });

      const rankedJobs: JobSearchResultItem[] = await rankJobs(
        filterResults,
        parsedSpec,
      );

      // Merge source lists back from dedup
      const dedupSourceMap = new Map(
        dedupResult.jobs.map((j) => {
          const { sources, ...jobData } = j;
          return [jobData.jobUrl, sources];
        }),
      );
      for (const item of rankedJobs) {
        item.sources = dedupSourceMap.get(item.job.jobUrl) ?? [item.job.source];
      }

      // Build results
      const results: JobSearchResults = {
        totalDiscovered: allJobs.length,
        totalAfterFilter: rankedJobs.length,
        duplicatesRemoved: dedupResult.duplicatesRemoved,
        highlyRelevant: rankedJobs.filter((r) => r.relevanceScore >= 70).length,
        incompleteInfo: rankedJobs.filter(
          (r) => r.unverifiedConstraints.length > 0,
        ).length,
        jobs: rankedJobs,
        sources: sourceStatuses,
        freshness,
      };

      // 7. Persist results
      const now = new Date().toISOString();
      await jobSearchRepo.updateJobSearch(searchId, {
        status: "completed",
        results,
        sourcesSucceeded,
        sourcesFailed,
        searchCompletedAt: now,
      });

      emitSearchProgress({
        type: "completed",
        searchId,
        totalDiscovered: results.totalDiscovered,
        totalAfterFilter: results.totalAfterFilter,
        duplicatesRemoved: results.duplicatesRemoved,
        results: rankedJobs,
        sources: sourceStatuses,
      });

      // 8. Email delivery — best-effort only. This step is fully isolated:
      //    it can never fail the search or affect persisted results, so the
      //    UI always shows results even when SMTP is unconfigured or broken.
      await attemptEmailDelivery(searchId);

      searchLogger.info("Job search completed", {
        totalDiscovered: results.totalDiscovered,
        totalAfterFilter: results.totalAfterFilter,
        duplicatesRemoved: results.duplicatesRemoved,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      searchLogger.error("Job search failed", error);

      await jobSearchRepo.updateJobSearch(searchId, {
        status: "failed",
        errorMessage: message,
        searchCompletedAt: new Date().toISOString(),
      });

      emitSearchProgress({ type: "failed", searchId, error: message });
    } finally {
      activeSearches.delete(searchId);
      // Clean up SSE listeners after a delay
      setTimeout(() => clearSearchProgress(searchId), 60_000);
    }
  });
}

/**
 * Check if a search is currently running.
 */
export function isSearchRunning(searchId: string): boolean {
  return activeSearches.has(searchId);
}

/**
 * Check for a cached recent search with the same hash.
 * Returns the cached search if found within the TTL window, null otherwise.
 */
export async function findCachedSearch(
  queryHash: string,
  cacheTtlMinutes: number,
): Promise<import("@shared/types").JobSearch | null> {
  const existing = await jobSearchRepo.getJobSearchByHash(queryHash);
  if (!existing) return null;

  // Running search — return it (don't start a duplicate)
  if (existing.status === "running") return existing;

  // Completed search within cache window
  if (existing.status === "completed" && cacheTtlMinutes > 0) {
    const completedAt = existing.searchCompletedAt
      ? new Date(existing.searchCompletedAt).getTime()
      : new Date(existing.createdAt).getTime();
    const ageMinutes = (Date.now() - completedAt) / 60_000;
    if (ageMinutes < cacheTtlMinutes) return existing;
  }

  return null;
}

/**
 * Attempt to email the search results to the user — best-effort only.
 *
 * Never throws and never touches the search's status/results: email is an
 * optional side-channel. With no SMTP configured it marks the search as
 * "skipped" and returns; unexpected email errors are contained here so the
 * search remains completed with results available in the UI.
 */
export async function attemptEmailDelivery(searchId: string): Promise<void> {
  const emailLogger = logger.child({ searchId, step: "email-delivery" });
  try {
    emitSearchProgress({
      type: "phase",
      searchId,
      phase: "emailing",
      message: "Sending results email...",
    });

    const search = await jobSearchRepo.getJobSearch(searchId);
    if (!search || search.status !== "completed") {
      emailLogger.info("Skipping email for non-completed search", {
        status: search?.status ?? "missing",
      });
      return;
    }

    const emailResult = await sendSearchResultsEmail(
      search,
      getPublicBaseUrl(),
    );
    const emailNow = new Date().toISOString();

    if (emailResult.success) {
      await jobSearchRepo.updateJobSearch(searchId, {
        emailStatus: "sent",
        emailSentAt: emailNow,
      });
      emitSearchProgress({ type: "email_sent", searchId });
      emailLogger.info("Job search email sent");
      return;
    }

    const isConfigIssue =
      emailResult.error === "SMTP not configured" ||
      emailResult.error === "No recipient email available";

    if (isConfigIssue) {
      await jobSearchRepo.updateJobSearch(searchId, {
        emailStatus: "skipped",
        emailError: emailResult.error ?? null,
      });
      emailLogger.info("Job search email skipped", {
        reason: emailResult.error,
      });
      emitSearchProgress({
        type: "email_skipped",
        searchId,
        reason: emailResult.error ?? "Email not configured",
      });
      return;
    }

    await jobSearchRepo.updateJobSearch(searchId, {
      emailStatus: "failed",
      emailError: emailResult.error ?? "Unknown email error",
    });
    emailLogger.warn("Job search email failed", {
      error: emailResult.error,
    });
    emitSearchProgress({
      type: "email_failed",
      searchId,
      error: emailResult.error ?? "Unknown email error",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    // Contain unexpected email errors: the search stays completed and the
    // results remain visible in the UI regardless.
    emailLogger.error("Unexpected email delivery error (search unaffected)", {
      error: message,
    });
    try {
      await jobSearchRepo.updateJobSearch(searchId, {
        emailStatus: "failed",
        emailError: message,
      });
    } catch (updateError) {
      emailLogger.error("Failed to record email error status", {
        error:
          updateError instanceof Error
            ? updateError.message
            : String(updateError),
      });
    }
    emitSearchProgress({
      type: "email_failed",
      searchId,
      error: message,
    });
  }
}

export { parseSearchQuery, computeSearchHash };
