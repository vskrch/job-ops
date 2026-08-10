/**
 * Job search orchestrator — main search execution flow (ADR-002).
 *
 * 1. Admit the search synchronously via its admission hash.
 * 2. Parse the NL query in the background (POST never waits for it).
 * 3. Build a manifest execution plan (one invocation per manifest).
 * 4. Run manifest tasks through the resource-aware scheduler.
 * 5. Ingest completions into a single accumulator; emit provisional
 *    snapshots when enabled.
 * 6. Final authoritative dedup + filter + LLM ranking.
 * 7. Persist the report and attempt optional email delivery.
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { getExtractorRegistry } from "@server/extractors/registry";
import * as jobSearchRepo from "@server/repositories/job-search";
import * as settingsRepo from "@server/repositories/settings";
import type {
  CreateJobInput,
  JobSearchResultItem,
  JobSearchResults,
  SearchSourceStatus,
} from "@shared/types";
import { sendSearchResultsEmail } from "../email";
import { SearchAccumulator } from "./accumulator";
import { computeFreshnessWindow } from "./filter";
import { clearSearchProgress, emitSearchProgress } from "./progress";
import { computeSearchHash, parseSearchQuery } from "./query-parser";
import { rankJobs } from "./ranking";
import { resolveSearchLimits } from "./resource-limits";
import { acquireSearchSlot } from "./scheduler";
import { buildSourcePlan } from "./source-plan";
import { runManifestTask } from "./source-runner";

// Single-flight: prevent the same search from running twice in-process.
const activeSearches = new Set<string>();

function getPublicBaseUrl(): string {
  return process.env.JOBOPS_PUBLIC_BASE_URL?.trim() || "http://localhost:3001";
}

async function updatePhase(
  searchId: string,
  phase:
    | "queued"
    | "parsing"
    | "planning"
    | "aggregating"
    | "filtering"
    | "ranking"
    | "reporting"
    | "emailing"
    | "completed"
    | "failed",
  message: string,
): Promise<void> {
  const now = new Date().toISOString();
  await jobSearchRepo.updateJobSearch(searchId, {
    phase,
    lastProgressAt: now,
  });
  emitSearchProgress({ type: "phase", searchId, phase, message });
}

/**
 * Execute a job search end-to-end in the background.
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

  let releaseSearchSlot: (() => void) | null = null;

  await runWithRequestContext({ searchId }, async () => {
    const searchLogger = logger.child({ searchId });
    searchLogger.info("Starting job search", { queryLength: query.length });

    try {
      const limits = await resolveSearchLimits();

      // Bounded process-wide admission. Waits briefly when another search is
      // active; fails fast when the wait queue is full.
      try {
        releaseSearchSlot = await acquireSearchSlot(limits.maxActiveSearches);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Search capacity reached";
        await jobSearchRepo.updateJobSearch(searchId, {
          status: "failed",
          phase: "failed",
          errorMessage: message,
          searchCompletedAt: new Date().toISOString(),
        });
        emitSearchProgress({ type: "failed", searchId, error: message });
        return;
      }

      // 1. Parse the query in the background.
      await updatePhase(
        searchId,
        "parsing",
        "Interpreting your search request...",
      );
      const parsedSpec = await parseSearchQuery(query);
      const specHash = computeSearchHash(query, parsedSpec);

      await jobSearchRepo.updateJobSearch(searchId, {
        specHash,
        parsedSpec,
        phase: "planning",
        lastProgressAt: new Date().toISOString(),
      });
      emitSearchProgress({
        type: "phase",
        searchId,
        phase: "planning",
        message: "Building source plan...",
      });

      // 2. Build the manifest execution plan.
      const [registry, settings] = await Promise.all([
        getExtractorRegistry(),
        settingsRepo.getAllSettings(),
      ]);
      const plan = await buildSourcePlan(parsedSpec, registry, settings);

      await jobSearchRepo.updateJobSearch(searchId, {
        sourcePlan: plan,
        evaluationTime: plan.evaluationTime,
        sourcesSearched: plan.tasks.flatMap((t) => t.selectedSources),
        phase: "aggregating",
        lastProgressAt: new Date().toISOString(),
      });

      emitSearchProgress({
        type: "started",
        searchId,
        parsedSpec,
        sourcesTotal: plan.tasks.length,
      });

      // 3. Aggregate through the scheduler; ingest into one accumulator.
      const accumulator = new SearchAccumulator(parsedSpec);
      const existingJobUrlsPromise: Promise<string[]> = Promise.resolve([]);
      const { runManifestTasks } = await import("./scheduler");

      let sourcesCompleted = 0;
      const sourceResults = await runManifestTasks({
        tasks: plan.tasks,
        perSearchConcurrency: limits.sourceConcurrency,
        onTaskStarted: (task) => {
          emitSearchProgress({
            type: "manifest_started",
            searchId,
            manifestId: task.manifestId,
            displayName: task.displayName,
            selectedSources: task.selectedSources,
            sourcesTotal: plan.tasks.length,
          });
        },
        onTaskSettled: () => {
          sourcesCompleted += 1;
        },
        task: async (task) => {
          const effectiveTimeout = Math.min(
            task.timeoutMs,
            limits.sourceTimeoutMs,
          );
          const result = await runManifestTask(
            task,
            parsedSpec,
            existingJobUrlsPromise,
            effectiveTimeout,
          );

          emitSearchProgress({
            type: "manifest_completed",
            searchId,
            manifestId: task.manifestId,
            status: result.status,
            jobsFound: result.jobs.length,
            error: result.error,
            sourcesCompleted,
            sourcesTotal: plan.tasks.length,
          });

          if (limits.partialResultsEnabled) {
            await accumulator.enqueue(() => {
              accumulator.ingest(result);
              const snapshot = accumulator.snapshot();
              emitSearchProgress({
                type: "results_partial",
                searchId,
                resultVersion: snapshot.resultVersion,
                provisional: true,
                results: snapshot.items,
                counts: {
                  discovered: snapshot.discovered,
                  afterFilter: snapshot.afterFilter,
                  duplicatesRemoved: snapshot.duplicatesRemoved,
                },
              });
            });
          } else {
            await accumulator.enqueue(() => accumulator.ingest(result));
          }

          return result;
        },
      });

      // 4. Final authoritative dedup + filter + ranking.
      await updatePhase(
        searchId,
        "filtering",
        "Deduplicating and filtering results...",
      );
      const { deduped, filterResults } = accumulator.finalFiltered();

      const removedByFreshness = parsedSpec.postedWithin.value
        ? filterResults.filter(
            (r) => !r.passed && r.filterReason?.includes("postedWithin"),
          ).length
        : 0;
      const freshness = computeFreshnessWindow(parsedSpec, removedByFreshness);

      await updatePhase(searchId, "ranking", "Ranking jobs by relevance...");
      const rankedJobs: JobSearchResultItem[] = await rankJobs(
        filterResults,
        parsedSpec,
        {
          concurrency: limits.rankingConcurrency,
          maxCandidates: limits.maxRankedCandidates,
          timeoutMs: limits.rankingTimeoutMs,
        },
      );

      // Attach merged source lists from dedup.
      const dedupSourceMap = new Map(
        deduped.map((j) => {
          const { sources, ...jobData } = j;
          return [jobData.jobUrl, sources];
        }),
      );
      for (const item of rankedJobs) {
        item.sources = dedupSourceMap.get(item.job.jobUrl) ?? [item.job.source];
      }

      const sourceStatuses: SearchSourceStatus[] = plan.tasks.map((task) => {
        const result = sourceResults.find(
          (r) => r.manifestId === task.manifestId,
        );
        const status = result?.status ?? "skipped";
        return {
          source: task.manifestId,
          displayName: task.displayName,
          selectedSources: task.selectedSources,
          status,
          jobsFound: result?.jobs.length ?? 0,
          error: result?.error ?? null,
        };
      });

      const results: JobSearchResults = {
        totalDiscovered: accumulator.totalDiscovered(),
        totalAfterFilter: rankedJobs.length,
        duplicatesRemoved: accumulator.totalDiscovered() - deduped.length,
        highlyRelevant: rankedJobs.filter((r) => r.relevanceScore >= 70).length,
        incompleteInfo: rankedJobs.filter(
          (r) => r.unverifiedConstraints.length > 0,
        ).length,
        jobs: rankedJobs,
        sources: sourceStatuses,
        freshness,
      };

      // 5. Persist the authoritative snapshot.
      await updatePhase(searchId, "reporting", "Saving results...");
      const now = new Date().toISOString();
      await jobSearchRepo.updateJobSearch(searchId, {
        status: "completed",
        results,
        resultVersion: accumulator.resultVersion + 1,
        sourcesSucceeded: sourceStatuses
          .filter((s) => s.status === "succeeded")
          .map((s) => s.source),
        sourcesFailed: sourceStatuses
          .filter((s) => s.status === "failed")
          .map((s) => `${s.source}: ${s.error ?? "unknown error"}`),
        phase: "completed",
        searchCompletedAt: now,
        lastProgressAt: now,
      });

      emitSearchProgress({
        type: "completed",
        searchId,
        totalDiscovered: results.totalDiscovered,
        totalAfterFilter: results.totalAfterFilter,
        duplicatesRemoved: results.duplicatesRemoved,
        results: rankedJobs,
        sources: sourceStatuses,
        resultVersion: accumulator.resultVersion + 1,
      });

      searchLogger.info("Job search completed", {
        totalDiscovered: results.totalDiscovered,
        totalAfterFilter: results.totalAfterFilter,
        duplicatesRemoved: results.duplicatesRemoved,
        sourcesCompleted,
        sourcesTotal: plan.tasks.length,
      });

      // 6. Email delivery — best-effort and fully isolated.
      await attemptEmailDelivery(searchId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      searchLogger.error("Job search failed", error);

      await jobSearchRepo.updateJobSearch(searchId, {
        status: "failed",
        phase: "failed",
        errorMessage: message,
        searchCompletedAt: new Date().toISOString(),
        lastProgressAt: new Date().toISOString(),
      });

      emitSearchProgress({ type: "failed", searchId, error: message });
    } finally {
      releaseSearchSlot?.();
      activeSearches.delete(searchId);
      // Clean up SSE listeners after a delay so late subscribers can catch up.
      setTimeout(() => clearSearchProgress(searchId), 60_000);
    }
  });
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

/**
 * Search status helpers for the route layer.
 */
export async function createSearchRecord(args: {
  admissionHash: string;
  originalQuery: string;
  parserVersion: string;
  sourcePlanVersion: string;
}) {
  return jobSearchRepo.createJobSearch(args);
}

export async function findReusableSearch(
  admissionHash: string,
  cacheTtlMs: number,
) {
  return jobSearchRepo.findReusableSearch(admissionHash, cacheTtlMs);
}

export async function getRunningSearchByAdmissionHash(admissionHash: string) {
  return jobSearchRepo.getRunningSearchByAdmissionHash(admissionHash);
}

export type { CreateJobInput };
