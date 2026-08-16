/**
 * LLM-powered relevance ranking for job search results (ADR-002).
 *
 * Runs AFTER strict deterministic filtering. Uses a single LlmService instance
 * per search with runtime settings resolved once, bounded concurrency, a
 * deterministic candidate cap, and per-job fallback scoring — a ranking
 * failure never aborts the remaining candidates.
 *
 * Hard constraints are enforced by the filter module — this never overrides
 * them.
 */

import { logger } from "@infra/logger";
import { asyncPool } from "@server/utils/async-pool";
import type {
  CreateJobInput,
  JobSearchResultItem,
  ParsedSearchSpec,
  ResumeProfile,
  UserProfile,
} from "@shared/types";
import { LlmService } from "../llm/service";
import type { JsonSchemaDefinition } from "../llm/types";
import { resolveLlmModel, resolveLlmRuntimeSettings } from "../modelSelection";
import {
  blendProfileScore,
  computeProfileMatchScore,
  type ProfileLike,
} from "../personalized-ranking";
import type { FilterResult } from "./filter";

const RELEVANCE_SCHEMA: JsonSchemaDefinition = {
  name: "job_relevance_score",
  schema: {
    type: "object",
    properties: {
      score: {
        type: "integer",
        description: "Relevance score from 0 to 100",
      },
      explanation: {
        type: "string",
        description:
          "1-2 sentence explanation of the relevance, referencing specific matched constraints",
      },
    },
    required: ["score", "explanation"],
    additionalProperties: false,
  },
};

export interface RankingOptions {
  /** Shared LLM client. Created once per search when omitted. */
  llm?: LlmService;
  /** Model resolved once per search when omitted. */
  model?: string;
  /** Maximum concurrent ranking requests (default 4). */
  concurrency?: number;
  /** Maximum candidates scored (default 100). */
  maxCandidates?: number;
  /** Per-request timeout (default 30s). */
  timeoutMs?: number;
  /**
   * Optional user profile (from an uploaded resume or the base resume).
   * When provided, LLM relevance (70%) is blended with the deterministic
   * profile match (30%) for personalized ranking.
   */
  userProfile?: ResumeProfile | UserProfile | ProfileLike | null;
}

/**
 * Build (or reuse) the shared ranking LLM configuration for a search.
 * Runtime settings are resolved once here, not per candidate.
 */
export async function createRankingRuntime(
  options: RankingOptions = {},
): Promise<{ llm: LlmService; model: string }> {
  if (options.llm && options.model) {
    return { llm: options.llm, model: options.model };
  }
  const runtime = await resolveLlmRuntimeSettings("default");
  const llm = options.llm ?? new LlmService(runtime);
  const model =
    options.model ?? runtime.model ?? (await resolveLlmModel("default"));
  return { llm, model };
}

/**
 * Deterministic pre-selection when candidates exceed the ranking budget.
 * Prefers jobs that pass more verified constraints and carry richer fields.
 * Never admits jobs that failed hard filtering (callers pass only passed items).
 */
function selectRankingCandidates(
  filterResults: FilterResult[],
  maxCandidates: number,
): FilterResult[] {
  if (filterResults.length <= maxCandidates) return filterResults;

  const scored = filterResults.map((filterResult, index) => {
    let heuristic = filterResult.verifiedConstraints.length * 10;
    const job = filterResult.job;
    if (job.title) heuristic += 3;
    if (job.skills) heuristic += 2;
    if (job.jobDescription) heuristic += 2;
    if (job.salary || job.salaryMinAmount) heuristic += 1;
    return { filterResult, heuristic, index };
  });

  scored.sort((a, b) => b.heuristic - a.heuristic || a.index - b.index);

  return scored.slice(0, maxCandidates).map(({ filterResult }) => filterResult);
}

/**
 * Score a single job's relevance against the search spec using the shared
 * LLM client. Never throws: failures convert to deterministic fallbacks.
 */
async function scoreJobRelevance(
  job: CreateJobInput,
  spec: ParsedSearchSpec,
  verifiedConstraints: string[],
  unverifiedConstraints: string[],
  runtime: { llm: LlmService; model: string },
  timeoutMs: number,
): Promise<{ score: number; explanation: string }> {
  try {
    const roleStr = spec.roles.length > 0 ? spec.roles.join(", ") : "any role";
    const skillsStr =
      spec.skills.length > 0 ? spec.skills.join(", ") : "not specified";
    const locationStr =
      [spec.location.country, ...spec.location.cities]
        .filter(Boolean)
        .join(", ") || "any location";
    const workModeStr = spec.workMode === "any" ? "any" : spec.workMode;
    const expStr =
      spec.experience.minYears !== null || spec.experience.maxYears !== null
        ? `${spec.experience.minYears ?? "any"}-${spec.experience.maxYears ?? "any"} years`
        : "not specified";
    const postedStr = spec.postedWithin.value
      ? `posted within ${spec.postedWithin.value} ${spec.postedWithin.unit}`
      : "any time";

    const prompt = `You are ranking job search results by relevance. Score how well this job matches the search criteria.

SEARCH CRITERIA:
- Roles: ${roleStr}
- Skills: ${skillsStr}
- Location: ${locationStr}
- Work mode: ${workModeStr}
- Experience: ${expStr}
- Posted: ${postedStr}
- Exclude terms: ${spec.excludeTerms.length > 0 ? spec.excludeTerms.join(", ") : "none"}

DETERMINISTIC FILTER RESULTS:
- Verified constraints: ${verifiedConstraints.join(", ") || "none"}
- Unverified constraints (unknown): ${unverifiedConstraints.join(", ") || "none"}

JOB:
- Title: ${job.title}
- Employer: ${job.employer}
- Location: ${job.location ?? "not specified"}
- Salary: ${job.salary ?? "not specified"}
- Work mode: ${job.isRemote === true ? "remote" : (job.workFromHomeType ?? "not specified")}
- Experience range: ${job.experienceRange ?? "not specified"}
- Job type: ${job.jobType ?? "not specified"}
- Skills: ${job.skills ?? "not specified"}
- Description: ${(job.jobDescription ?? "").slice(0, 1000)}

Score 0-100 based on: title match (0-30), skills match (0-25), location/work-mode (0-20), experience (0-15), semantic similarity of description to query (0-10).

Respond with ONLY valid JSON: {"score": <integer 0-100>, "explanation": "<1-2 sentences referencing specific matched constraints>"}`;

    const result = await runtime.llm.callJson<{
      score: number;
      explanation: string;
    }>({
      model: runtime.model,
      messages: [{ role: "user", content: prompt }],
      jsonSchema: RELEVANCE_SCHEMA,
      maxRetries: 1,
      timeoutMs,
    });

    if (!result.success) {
      logger.debug("Relevance scoring LLM failed, using fallback", {
        error: result.error,
        jobTitle: job.title,
      });
      return {
        score: fallbackScore(verifiedConstraints, unverifiedConstraints),
        explanation:
          "Relevance scored by deterministic fallback (LLM unavailable).",
      };
    }

    const score = Math.min(100, Math.max(0, Math.round(result.data.score)));
    return {
      score,
      explanation: result.data.explanation || "No explanation provided.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.debug("Relevance scoring threw, using fallback", {
      error: message,
      jobTitle: job.title,
    });
    return {
      score: fallbackScore(verifiedConstraints, unverifiedConstraints),
      explanation:
        "Relevance scored by deterministic fallback (scoring error).",
    };
  }
}

function fallbackScore(verified: string[], unverified: string[]): number {
  let score = 30;
  const constraintCount = verified.length + unverified.length;
  score += verified.length * 12;
  score += unverified.length * 4;
  if (constraintCount === 0) score = 50;
  return Math.min(100, score);
}

/**
 * Rank filtered jobs by relevance using the shared LLM client.
 * Returns results sorted by relevance score descending (deterministic tie
 * order: job URL ascending).
 */
export async function rankJobs(
  filterResults: FilterResult[],
  spec: ParsedSearchSpec,
  options: RankingOptions = {},
): Promise<JobSearchResultItem[]> {
  const passed = filterResults.filter((r) => r.passed);
  if (passed.length === 0) return [];

  const runtime = await createRankingRuntime(options);
  const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
  const maxCandidates = Math.max(1, options.maxCandidates ?? 100);
  const timeoutMs = options.timeoutMs ?? 30_000;

  const candidates = selectRankingCandidates(passed, maxCandidates);

  // Precompute deterministic profile-match scores once (never inside the
  // concurrent pool, and never per candidate when no profile is available).
  const profileScores = new Map<string, number>();
  if (options.userProfile) {
    for (const candidate of passed) {
      const score = computeProfileMatchScore(
        candidate.job,
        options.userProfile,
      );
      profileScores.set(candidate.job.jobUrl, score);
    }
  }

  const scored = await asyncPool({
    items: candidates,
    concurrency,
    task: async (filterResult) => {
      const { score, explanation } = await scoreJobRelevance(
        filterResult.job,
        spec,
        filterResult.verifiedConstraints,
        filterResult.unverifiedConstraints,
        runtime,
        timeoutMs,
      );
      const profileScore = profileScores.get(filterResult.job.jobUrl);
      if (profileScore === undefined) {
        return { filter: filterResult, score, explanation };
      }
      const blended = blendProfileScore(score, profileScore, explanation, true);
      return {
        filter: filterResult,
        score: blended.score,
        explanation: blended.explanation,
      };
    },
  });

  scored.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    return a.filter.job.jobUrl.localeCompare(b.filter.job.jobUrl);
  });

  return scored.map(
    ({ filter, score, explanation }): JobSearchResultItem => ({
      job: filter.job,
      sources: [],
      relevanceScore: score,
      matchExplanation: explanation,
      verifiedConstraints: filter.verifiedConstraints,
      unverifiedConstraints: filter.unverifiedConstraints,
      filteredOut: false,
      filterReason: null,
    }),
  );
}
