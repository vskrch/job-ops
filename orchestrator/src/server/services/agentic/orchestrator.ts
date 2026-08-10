/**
 * Agentic search orchestrator (ADR-001 v2).
 *
 * Iterative agentic loop that wraps the deterministic job-search pipeline:
 *
 *   1. Parse the NL query into a goal + constraints (LLM)
 *   2. Iterative search loop, bounded by per-search budget:
 *      a. Build source plan + run manifests with the current (expanded) terms
 *      b. Deduplicate + filter
 *      c. Evaluate coverage (LLM); if insufficient and refinement is
 *         enabled and budget allows → expand search terms → repeat
 *   3. Verify unverified candidates against hard constraints (LLM) and
 *      apply verdicts (contradicted jobs are excluded, verified constraints
 *      upgrade to verified) — before final ranking (ADR §5)
 *   4. Rank final results (LLM)
 *   5. Save the search record and attempt email delivery
 *
 * Safety controls: per-search budget (ADR §7), cancellation checked between
 * steps (ADR §13), tool-call audit records, concurrency gate, and fallback to
 * the existing one-shot pipeline (`executeJobSearch`) on failure.
 */

import { createHash } from "node:crypto";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import { getExtractorRegistry } from "@server/extractors/registry";
import * as agenticRepo from "@server/repositories/agentic-search";
import * as jobSearchRepo from "@server/repositories/job-search";
import * as jobsRepo from "@server/repositories/jobs";
import type { SettingKey } from "@server/repositories/settings";
import * as settingsRepo from "@server/repositories/settings";
import type {
  AgenticGoal,
  AgenticSearch,
  CreateJobInput,
  JobSearchResults,
  ParsedSearchSpec,
  SearchExpansion,
  SearchSourceStatus,
} from "@shared/types";
import { sendSearchResultsEmail } from "../email";
import {
  executeJobSearch,
  JOB_SEARCH_PARSER_VERSION,
  parseSearchQuery,
} from "../job-search";
import { deduplicateJobs } from "../job-search/dedup";
import { filterJobs } from "../job-search/filter";
import { rankJobs } from "../job-search/ranking";
import {
  resolveSearchLimits,
  SOURCE_PLAN_VERSION,
} from "../job-search/resource-limits";
import { buildSourcePlan } from "../job-search/source-plan";
import { runManifestTask } from "../job-search/source-runner";
import { getProfile } from "../profile";
import { createBudgetTracker } from "./budget";
import { evaluateCoverage } from "./coverage-evaluator";
import { clearAgenticSearchProgress, emitAgenticProgress } from "./progress";
import { verifyJobConstraints } from "./verifier";

const activeAgenticSearches = new Set<string>();

const MIN_COVERAGE_SCORE = 70;
const TOP_JOBS_TO_VERIFY = 10;
const MAX_RANKED_JOBS = 50;

// ADR §7: concurrent agentic searches are capped in-process (env-overridable).
const MAX_CONCURRENT_AGENTIC_SEARCHES = Number.parseInt(
  process.env.AGENTIC_SEARCH_CONCURRENCY ?? "2",
  10,
);
let activeAgenticSlots = 0;
const agenticSlotWaiters: Array<() => void> = [];

async function acquireAgenticSlot(): Promise<() => void> {
  if (activeAgenticSlots < MAX_CONCURRENT_AGENTIC_SEARCHES) {
    activeAgenticSlots += 1;
    return releaseAgenticSlot;
  }
  await new Promise<void>((resolve) => agenticSlotWaiters.push(resolve));
  activeAgenticSlots += 1;
  return releaseAgenticSlot;
}

function releaseAgenticSlot(): void {
  activeAgenticSlots = Math.max(0, activeAgenticSlots - 1);
  const next = agenticSlotWaiters.shift();
  if (next) next();
}

async function readBoolSetting(
  key: SettingKey,
  defaultValue: boolean,
): Promise<boolean> {
  const raw = await settingsRepo.getSetting(key);
  if (raw === null || raw === undefined || raw === "") return defaultValue;
  return raw === "1" || raw === "true";
}

async function readNumberSetting(
  key: SettingKey,
  defaultValue: number,
): Promise<number> {
  const raw = await settingsRepo.getSetting(key);
  const n = Number.parseFloat(raw ?? "");
  return Number.isNaN(n) ? defaultValue : n;
}

/**
 * Master toggle (ADR §14). Reads the `agenticSearchEnabled` setting
 * (default off) with an env override for testing.
 */
export async function isAgenticSearchEnabled(): Promise<boolean> {
  if (process.env.AGENTIC_SEARCH_ENABLED === "true") return true;
  if (process.env.AGENTIC_SEARCH_ENABLED === "false") return false;
  return readBoolSetting("agenticSearchEnabled", false);
}

export async function startAgenticSearch(
  originalQuery: string,
): Promise<AgenticSearch> {
  const queryHash = computeQueryHash(originalQuery);
  const existing = await agenticRepo.getAgenticSearchByHash(queryHash);
  if (
    existing &&
    (existing.status === "created" ||
      existing.status === "searching" ||
      existing.status === "planning")
  ) {
    return existing;
  }

  const search = await agenticRepo.createAgenticSearch({
    originalQuery,
    queryHash,
  });

  void runAgenticLoop(search.id, originalQuery).catch((err) => {
    logger.error("Agentic search loop failed", {
      searchId: search.id,
      error: sanitizeUnknown(err),
    });
    void agenticRepo.updateAgenticSearch(search.id, {
      status: "failed",
      failureReason: sanitizeError(err, 500),
      completedAt: new Date().toISOString(),
    });
    emitAgenticProgress(search.id, {
      type: "agentic_failed",
      error: sanitizeError(err, 200),
      fallbackSearchId: null,
    });
    clearAgenticSearchProgress(search.id);
  });

  return search;
}

export async function cancelAgenticSearch(
  searchId: string,
): Promise<AgenticSearch | null> {
  const search = await agenticRepo.getAgenticSearch(searchId);
  if (!search) return null;
  if (
    search.status === "completed" ||
    search.status === "failed" ||
    search.status === "cancelled"
  ) {
    return search;
  }

  await agenticRepo.updateAgenticSearch(searchId, {
    status: "cancelled",
    completedAt: new Date().toISOString(),
  });
  emitAgenticProgress(searchId, {
    type: "agentic_failed",
    error: "Search was cancelled",
    fallbackSearchId: null,
  });
  clearAgenticSearchProgress(searchId);

  return agenticRepo.getAgenticSearch(searchId);
}

async function isSearchCancelled(searchId: string): Promise<boolean> {
  const search = await agenticRepo.getAgenticSearch(searchId);
  return search?.status === "cancelled";
}

function sanitizeError(error: unknown, maxLength: number): string {
  const sanitized = sanitizeUnknown(error);
  const text =
    typeof sanitized === "string"
      ? sanitized
      : sanitized && typeof sanitized === "object" && "message" in sanitized
        ? String((sanitized as { message: unknown }).message)
        : JSON.stringify(sanitized);
  return (text ?? "unknown error").slice(0, maxLength);
}

async function recordToolCall(args: {
  searchId: string;
  toolName: string;
  iteration: number;
  argumentsSummary?: string;
  resultSummary?: string;
  status?: "completed" | "failed";
  latencyMs?: number;
  error?: string;
}): Promise<void> {
  await agenticRepo.addToolCall({
    searchId: args.searchId,
    toolName: args.toolName,
    iteration: args.iteration,
    argumentsSummary: args.argumentsSummary,
    resultSummary: args.error
      ? `failed: ${args.error.slice(0, 200)}`
      : args.resultSummary,
    status: args.status ?? (args.error ? "failed" : "completed"),
    latencyMs: args.latencyMs,
  });
}

/**
 * Build verification items from the parsed spec so the LLM verifies against
 * the user's actual constraints (roles, location, work mode, salary, …).
 */
function buildVerificationItems(
  spec: ParsedSearchSpec,
): Array<{ constraintKey: string; expectedValue: unknown; hard: boolean }> {
  const items: Array<{
    constraintKey: string;
    expectedValue: unknown;
    hard: boolean;
  }> = [];
  if (spec.roles.length > 0)
    items.push({
      constraintKey: "roles",
      expectedValue: spec.roles,
      hard: true,
    });
  if (spec.skills.length > 0)
    items.push({
      constraintKey: "skills",
      expectedValue: spec.skills,
      hard: true,
    });
  if (spec.location.country || spec.location.cities.length > 0)
    items.push({
      constraintKey: "location",
      expectedValue: {
        country: spec.location.country,
        cities: spec.location.cities,
      },
      hard: true,
    });
  if (spec.workMode !== "any")
    items.push({
      constraintKey: "work_mode",
      expectedValue: spec.workMode,
      hard: true,
    });
  if (spec.experience.minYears !== null || spec.experience.maxYears !== null)
    items.push({
      constraintKey: "experience",
      expectedValue: {
        minYears: spec.experience.minYears,
        maxYears: spec.experience.maxYears,
      },
      hard: true,
    });
  if (spec.salary.min !== null || spec.salary.max !== null)
    items.push({
      constraintKey: "salary",
      expectedValue: {
        min: spec.salary.min,
        max: spec.salary.max,
        currency: spec.salary.currency,
      },
      hard: true,
    });
  if (spec.excludeTerms.length > 0)
    items.push({
      constraintKey: "exclude_terms",
      expectedValue: spec.excludeTerms,
      hard: true,
    });
  return items;
}

async function runAgenticLoop(
  searchId: string,
  originalQuery: string,
): Promise<void> {
  if (activeAgenticSearches.has(searchId)) return;
  activeAgenticSearches.add(searchId);
  const releaseSlot = await acquireAgenticSlot();

  try {
    const [maxIterations, maxCost, verificationEnabled, refinementEnabled] =
      await Promise.all([
        readNumberSetting("agenticMaxIterations", 5),
        readNumberSetting("agenticMaxCostPerSearch", 0.5),
        readBoolSetting("agenticVerificationEnabled", true),
        readBoolSetting("agenticRefinementEnabled", true),
      ]);

    const budget = createBudgetTracker({
      maxIterations: Math.max(1, Math.min(10, Math.floor(maxIterations))),
      maxEstimatedCost: Math.max(0, maxCost),
    });
    const limits = budget.getLimits();

    // Keep the persisted record's iteration cap in sync with the budget.
    await agenticRepo.updateAgenticSearch(searchId, {
      maxIterations: limits.maxIterations,
    });

    await agenticRepo.updateAgenticSearch(searchId, {
      status: "planning",
      startedAt: new Date().toISOString(),
      currentStep: "parsing_query",
    });
    emitAgenticProgress(searchId, {
      type: "agentic_step",
      step: "planning",
      message: `Starting agentic search: ${originalQuery}`,
    });

    // --- Phase 1: Parse query (parse_search_query tool) ---
    const parseStart = Date.now();
    const spec = await parseSearchQuery(originalQuery);
    await recordToolCall({
      searchId,
      toolName: "parse_search_query",
      iteration: 1,
      argumentsSummary: `query: ${originalQuery.slice(0, 120)}`,
      resultSummary: `roles: ${spec.roles.join(", ")}, constraints: ${spec.explicitConstraints.length}`,
      latencyMs: Date.now() - parseStart,
    });
    budget.recordLlmCall(1, 0.002);

    const goal: AgenticGoal = {
      summary: spec.interpretation,
      searchTerms: [...spec.roles, ...spec.skills],
      expandedTerms: [...spec.roles, ...spec.skills],
      expansionReason: null,
    };

    await agenticRepo.updateAgenticSearch(searchId, {
      goal,
      currentStep: "query_parsed",
      iterationCount: 0,
    });
    emitAgenticProgress(searchId, {
      type: "agentic_started",
      goal,
    });

    if (await isSearchCancelled(searchId)) {
      logger.info("Agentic search cancelled before search phase", {
        searchId,
      });
      return;
    }

    // --- Phase 2: Iterative search loop ---
    let allJobs: CreateJobInput[] = [];
    let totalDuplicatesRemoved = 0;
    let iteration = 0;
    let coverageScore = 0;
    const searchExpansions: SearchExpansion[] = [];
    const sourceStatuses: SearchSourceStatus[] = [];

    while (iteration < limits.maxIterations) {
      iteration += 1;
      budget.incrementIteration();
      const budgetCheck = budget.canContinue();
      if (!budgetCheck.ok) {
        logger.info("Budget exhausted, stopping iterations", {
          searchId,
          reason: budgetCheck.reason,
        });
        break;
      }

      if (await isSearchCancelled(searchId)) {
        logger.info("Agentic search cancelled, stopping", { searchId });
        return;
      }

      await agenticRepo.updateAgenticSearch(searchId, {
        status: "searching",
        currentStep: `iteration_${iteration}_searching`,
        iterationCount: iteration,
      });
      emitAgenticProgress(searchId, {
        type: "agentic_iteration",
        iteration,
        maxIterations: limits.maxIterations,
        reason:
          iteration === 1
            ? "initial search"
            : `refinement after coverage ${coverageScore}`,
      });

      // --- Search (search_jobs tool) ---
      // Expanded terms (ADR §9) drive the extractor search each iteration;
      // hard constraints in `spec` are never expanded.
      const iterationSpec: ParsedSearchSpec = {
        ...spec,
        roles: goal.expandedTerms,
      };

      const searchStart = Date.now();
      const registry = await getExtractorRegistry();
      const settings = await settingsRepo.getAllSettings();
      const sourcePlan = await buildSourcePlan(
        iterationSpec,
        registry,
        settings,
      );
      const manifestTimeout = (await resolveSearchLimits()).sourceTimeoutMs;
      const existingJobUrls = jobsRepo.getAllJobUrls();

      const settled = await Promise.allSettled(
        sourcePlan.tasks.map((task) =>
          runManifestTask(
            task,
            iterationSpec,
            existingJobUrls,
            manifestTimeout,
          ),
        ),
      );

      const iterationJobs: CreateJobInput[] = [];
      let failedSources = 0;
      for (const result of settled) {
        if (
          result.status === "fulfilled" &&
          result.value.status === "succeeded"
        ) {
          iterationJobs.push(...result.value.jobs);
          sourceStatuses.push({
            source: result.value.manifestId,
            displayName: result.value.displayName,
            selectedSources: result.value.selectedSources,
            status: "succeeded",
            jobsFound: result.value.jobs.length,
            error: null,
          });
        } else if (
          result.status === "fulfilled" &&
          result.value.status === "failed"
        ) {
          failedSources += 1;
          sourceStatuses.push({
            source: result.value.manifestId,
            displayName: result.value.displayName,
            selectedSources: result.value.selectedSources,
            status: "failed",
            jobsFound: 0,
            error: result.value.error,
          });
        }
      }
      await recordToolCall({
        searchId,
        toolName: "search_jobs",
        iteration,
        argumentsSummary: `terms: ${goal.expandedTerms.join(", ")}`,
        resultSummary: `${iterationJobs.length} jobs from ${sourcePlan.tasks.length} manifests (${failedSources} failed)`,
        latencyMs: Date.now() - searchStart,
      });

      allJobs = [...allJobs, ...iterationJobs];

      // --- Deduplicate (deduplicate_jobs tool) ---
      await agenticRepo.updateAgenticSearch(searchId, {
        status: "deduplicating",
        currentStep: `iteration_${iteration}_dedup`,
      });
      const dedupStart = Date.now();
      const dedupResult = deduplicateJobs(allJobs);
      allJobs = dedupResult.jobs as CreateJobInput[];
      totalDuplicatesRemoved += dedupResult.duplicatesRemoved;
      await recordToolCall({
        searchId,
        toolName: "deduplicate_jobs",
        iteration,
        argumentsSummary: `${iterationJobs.length} new jobs`,
        resultSummary: `${dedupResult.duplicatesRemoved} duplicates removed, ${allJobs.length} unique`,
        latencyMs: Date.now() - dedupStart,
      });

      // --- Filter (filter_jobs tool) ---
      await agenticRepo.updateAgenticSearch(searchId, {
        status: "filtering",
        currentStep: `iteration_${iteration}_filter`,
      });
      const filterStart = Date.now();
      const filterResults = filterJobs(allJobs, iterationSpec);
      const passedJobs = filterResults
        .filter((r) => r.passed)
        .map((r) => r.job);
      await recordToolCall({
        searchId,
        toolName: "filter_jobs",
        iteration,
        argumentsSummary: `${allJobs.length} jobs`,
        resultSummary: `${passedJobs.length} passed strict constraints`,
        latencyMs: Date.now() - filterStart,
      });

      if (!refinementEnabled) {
        logger.info("Refinement disabled, proceeding to ranking", {
          searchId,
        });
        break;
      }

      // --- Evaluate coverage (evaluate_coverage tool) ---
      await agenticRepo.updateAgenticSearch(searchId, {
        status: "evaluating",
        currentStep: `iteration_${iteration}_evaluate`,
      });
      emitAgenticProgress(searchId, {
        type: "agentic_step",
        step: "evaluating",
        message: `Iteration ${iteration}: ${passedJobs.length} jobs after filtering`,
      });

      const coverageStart = Date.now();
      const coverage = await evaluateCoverage(
        goal,
        spec,
        passedJobs.length,
        searchId,
      );
      coverageScore = coverage.overallScore;
      await recordToolCall({
        searchId,
        toolName: "evaluate_coverage",
        iteration,
        argumentsSummary: `goal: ${goal.summary.slice(0, 100)}, results: ${passedJobs.length}`,
        resultSummary: `score: ${coverageScore}, refine: ${coverage.shouldRefine}`,
        latencyMs: Date.now() - coverageStart,
      });
      budget.recordLlmCall(1, 0.005);

      await agenticRepo.updateAgenticSearch(searchId, {
        budgetUsed: budget.getUsage(),
      });
      emitAgenticProgress(searchId, {
        type: "agentic_budget",
        budgetUsed: budget.getUsage(),
      });

      if (coverageScore >= MIN_COVERAGE_SCORE || !coverage.shouldRefine) {
        logger.info("Coverage sufficient, proceeding to ranking", {
          searchId,
          score: coverageScore,
          iteration,
        });
        break;
      }

      // --- Refine for next iteration (expansion, ADR §9) ---
      if (coverage.suggestions.length > 0 || coverage.gaps.length > 0) {
        const newTerms = [...goal.expandedTerms];
        for (const suggestion of coverage.suggestions) {
          const lower = suggestion.toLowerCase();
          if (!newTerms.some((t) => lower.includes(t.toLowerCase()))) {
            newTerms.push(suggestion);
          }
        }

        searchExpansions.push({
          originalTerms: [...goal.searchTerms],
          expandedTerms: newTerms,
          reason: `Coverage score ${coverageScore} < ${MIN_COVERAGE_SCORE}. Gaps: ${coverage.gaps.join("; ")}`,
          iteration,
        });

        goal.searchTerms = newTerms;
        goal.expansionReason = `Refined after iteration ${iteration} (coverage: ${coverageScore})`;
        goal.expandedTerms = newTerms;

        await agenticRepo.updateAgenticSearch(searchId, {
          status: "refining",
          currentStep: `iteration_${iteration}_refine`,
          goal,
          searchExpansions,
        });
        emitAgenticProgress(searchId, {
          type: "agentic_expansion",
          expandedTerms: newTerms,
          reason: `Refined: ${coverage.suggestions.join(", ")}`,
        });
      }
    }

    if (await isSearchCancelled(searchId)) {
      logger.info("Agentic search cancelled before ranking", { searchId });
      return;
    }

    // --- Phase 3: Verify unverified candidates (verify_job tool) ---
    // Runs BEFORE ranking so verdicts can shape the final order (ADR §5).
    const verificationItems = buildVerificationItems(spec);
    const unverifiedCandidates = filterJobs(allJobs, spec)
      .filter((r) => r.passed && r.unverifiedConstraints.length > 0)
      .slice(0, TOP_JOBS_TO_VERIFY);

    const verificationOutcomes = new Map<
      string,
      { verifiedKeys: Set<string>; contradicted: boolean }
    >();

    if (
      verificationEnabled &&
      verificationItems.length > 0 &&
      unverifiedCandidates.length > 0
    ) {
      await agenticRepo.updateAgenticSearch(searchId, {
        status: "verifying",
        currentStep: "verifying_top_results",
      });
      emitAgenticProgress(searchId, {
        type: "agentic_verification",
        jobsVerifying: unverifiedCandidates.length,
        jobsVerified: 0,
      });

      let jobsVerified = 0;
      let verificationLlmCalls = 0;
      for (const candidate of unverifiedCandidates) {
        const budgetCheck = budget.canContinue();
        if (!budgetCheck.ok) {
          logger.info("Budget exhausted, stopping verification", {
            searchId,
            reason: budgetCheck.reason,
          });
          break;
        }
        if (await isSearchCancelled(searchId)) {
          logger.info("Agentic search cancelled during verification", {
            searchId,
          });
          break;
        }

        budget.recordVerificationCall();
        const verifyStart = Date.now();
        const outcomes = await verifyJobConstraints(
          candidate.job,
          searchId,
          verificationItems,
        );
        verificationLlmCalls += 1;
        await recordToolCall({
          searchId,
          toolName: "verify_job",
          iteration,
          argumentsSummary: `job: ${candidate.job.title.slice(0, 80)}, constraints: ${verificationItems.length}`,
          resultSummary: `${candidate.job.jobUrl.slice(0, 100)} verified`,
          latencyMs: Date.now() - verifyStart,
        });

        const verifiedKeys = new Set<string>();
        const contradicted = outcomes.some((o) => o.status === "contradicted");
        for (const outcome of outcomes) {
          if (outcome.status === "verified")
            verifiedKeys.add(outcome.constraintKey);
        }
        verificationOutcomes.set(candidate.job.jobUrl, {
          verifiedKeys,
          contradicted,
        });

        jobsVerified += 1;
        emitAgenticProgress(searchId, {
          type: "agentic_verification",
          jobsVerifying: unverifiedCandidates.length,
          jobsVerified,
        });
      }
      budget.recordLlmCall(verificationLlmCalls, 0.005);
    }

    if (await isSearchCancelled(searchId)) {
      logger.info("Agentic search cancelled before ranking", { searchId });
      return;
    }

    // --- Phase 4: Rank (rank_jobs tool) ---
    await agenticRepo.updateAgenticSearch(searchId, {
      status: "ranking",
      currentStep: "final_ranking",
    });
    emitAgenticProgress(searchId, {
      type: "agentic_step",
      step: "ranking",
      message: "Ranking final results...",
    });

    // Apply verification verdicts: contradicted jobs are excluded; verified
    // constraints upgrade from unverified to verified for ranking context.
    const finalFilterResults = filterJobs(allJobs, spec).map((filterResult) => {
      if (!filterResult.passed) return filterResult;
      const outcome = verificationOutcomes.get(filterResult.job.jobUrl);
      if (!outcome) return filterResult;
      if (outcome.contradicted) {
        return {
          ...filterResult,
          passed: false,
          filterReason: "verification_contradicted",
        };
      }
      if (outcome.verifiedKeys.size > 0) {
        return {
          ...filterResult,
          verifiedConstraints: [
            ...new Set([
              ...filterResult.verifiedConstraints,
              ...outcome.verifiedKeys,
            ]),
          ],
          unverifiedConstraints: filterResult.unverifiedConstraints.filter(
            (key) => !outcome.verifiedKeys.has(key),
          ),
        };
      }
      return filterResult;
    });

    const rankStart = Date.now();
    const userProfile = await loadRankingProfile();
    const ranked = await rankJobs(finalFilterResults, spec, {
      userProfile,
    });
    const rankedCandidateCount = finalFilterResults.filter(
      (r) => r.passed,
    ).length;
    await recordToolCall({
      searchId,
      toolName: "rank_jobs",
      iteration,
      argumentsSummary: `${rankedCandidateCount} candidates`,
      resultSummary: `${ranked.length} ranked results`,
      latencyMs: Date.now() - rankStart,
    });
    if (rankedCandidateCount > 0) {
      budget.recordLlmCall(1, 0.05);
    }

    if (await isSearchCancelled(searchId)) {
      logger.info("Agentic search cancelled before report", { searchId });
      return;
    }

    // --- Phase 5: Report ---
    const highlyRelevant = ranked.filter((r) => r.relevanceScore >= 70).length;
    const incompleteInfo = ranked.filter(
      (r) => r.unverifiedConstraints.length > 0,
    ).length;
    const freshnessWindow = getFreshnessWindow(spec);

    // One status entry per manifest (last iteration wins); iteration statuses
    // are snapshots of the same manifest and would otherwise duplicate.
    const finalSourceStatuses = Array.from(
      new Map(sourceStatuses.map((status) => [status.source, status])).values(),
    );

    const results: JobSearchResults = {
      totalDiscovered: allJobs.length,
      totalAfterFilter: rankedCandidateCount,
      duplicatesRemoved: totalDuplicatesRemoved,
      highlyRelevant,
      incompleteInfo,
      jobs: ranked.slice(0, MAX_RANKED_JOBS),
      sources: finalSourceStatuses,
      freshness: freshnessWindow,
    };

    await agenticRepo.updateAgenticSearch(searchId, {
      status: "completed",
      results,
      currentStep: "completed",
      completedAt: new Date().toISOString(),
      budgetUsed: budget.getUsage(),
      searchExpansions,
    });
    emitAgenticProgress(searchId, {
      type: "agentic_completed",
      results,
    });
    clearAgenticSearchProgress(searchId);

    // --- Phase 6: Save + email (save_search / send_search_email tools) ---
    try {
      const searchRecord = await jobSearchRepo.createJobSearch({
        admissionHash: computeQueryHash(originalQuery),
        originalQuery,
        parserVersion: JOB_SEARCH_PARSER_VERSION,
        sourcePlanVersion: SOURCE_PLAN_VERSION,
      });
      await recordToolCall({
        searchId,
        toolName: "save_search",
        iteration,
        argumentsSummary: `query: ${originalQuery.slice(0, 120)}`,
        resultSummary: `saved search record ${searchRecord?.id ?? "(duplicate)"}`,
      });

      if (searchRecord) {
        await jobSearchRepo.updateJobSearch(searchRecord.id, {
          status: "completed",
          phase: "completed",
          parsedSpec: spec,
          results,
          sourcesSearched: finalSourceStatuses.map((s) => s.source),
          sourcesSucceeded: finalSourceStatuses
            .filter((s) => s.status === "succeeded")
            .map((s) => s.source),
          sourcesFailed: finalSourceStatuses
            .filter((s) => s.status === "failed")
            .map((s) => s.source),
          searchCompletedAt: new Date().toISOString(),
        });

        await recordToolCall({
          searchId,
          toolName: "send_search_email",
          iteration,
          argumentsSummary: `search: ${searchRecord.id}`,
        });
        await sendSearchResultsEmail(searchRecord, getPublicBaseUrl());
      }
    } catch (err) {
      logger.warn("Failed to save or email agentic search results", {
        searchId,
        error: sanitizeUnknown(err),
      });
    }
  } catch (error) {
    // Fallback: run the existing one-shot pipeline (ADR §13).
    const message = sanitizeError(error, 500);
    logger.error("Agentic search failed, falling back to pipeline", {
      searchId,
      error: sanitizeUnknown(error),
    });

    let fallbackSearchId: string | null = null;
    try {
      const fallbackSearch = await jobSearchRepo.createJobSearch({
        admissionHash: computeQueryHash(originalQuery),
        originalQuery,
        parserVersion: JOB_SEARCH_PARSER_VERSION,
        sourcePlanVersion: SOURCE_PLAN_VERSION,
      });
      if (fallbackSearch) {
        fallbackSearchId = fallbackSearch.id;
        runWithRequestContext({ searchId: fallbackSearch.id }, () => {
          executeJobSearch(fallbackSearch.id, originalQuery).catch((err) => {
            logger.error("Fallback job search failed", {
              searchId: fallbackSearch.id,
              error: sanitizeUnknown(err),
            });
          });
        });
      }
    } catch (fallbackError) {
      logger.error("Fallback search setup failed", {
        searchId,
        error: sanitizeUnknown(fallbackError),
      });
    }

    await agenticRepo.updateAgenticSearch(searchId, {
      status: "partial",
      failureReason: `Agentic loop failed, fell back to pipeline: ${message}`,
      fallbackSearchId,
      completedAt: new Date().toISOString(),
    });
    emitAgenticProgress(searchId, {
      type: "agentic_failed",
      error: message.slice(0, 200),
      fallbackSearchId,
    });
    clearAgenticSearchProgress(searchId);
  } finally {
    activeAgenticSearches.delete(searchId);
    releaseSlot();
  }
}

function getFreshnessWindow(spec: ParsedSearchSpec): {
  requested: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  removedByFreshness: number;
} {
  const requested =
    spec.postedWithin.value !== null && spec.postedWithin.unit !== null
      ? `last ${spec.postedWithin.value} ${spec.postedWithin.unit}`
      : null;

  let effectiveStart: string | null = null;
  if (spec.postedWithin.value !== null && spec.postedWithin.unit !== null) {
    const start = new Date();
    if (spec.postedWithin.unit === "hours")
      start.setHours(start.getHours() - spec.postedWithin.value);
    else if (spec.postedWithin.unit === "days")
      start.setDate(start.getDate() - spec.postedWithin.value);
    else if (spec.postedWithin.unit === "weeks")
      start.setDate(start.getDate() - spec.postedWithin.value * 7);
    effectiveStart = start.toISOString();
  }

  return {
    requested,
    effectiveStart,
    effectiveEnd: new Date().toISOString(),
    removedByFreshness: 0,
  };
}

function getPublicBaseUrl(): string {
  return process.env.JOBOPS_PUBLIC_BASE_URL?.trim() || "http://localhost:3001";
}

/**
 * Load the user profile for personalized ranking. Never throws — ranking
 * degrades to relevance-only when no profile is configured or the
 * personalization flag is off.
 */
async function loadRankingProfile(): Promise<
  import("@shared/types").ResumeProfile | null
> {
  const raw = await settingsRepo.getSetting("agenticPersonalizationEnabled");
  if (raw === "0" || raw === "false") return null;
  try {
    return await getProfile();
  } catch {
    return null;
  }
}

function computeQueryHash(query: string): string {
  return createHash("sha256")
    .update(query.toLowerCase().trim())
    .digest("hex")
    .slice(0, 16);
}
