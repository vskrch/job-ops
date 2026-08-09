/**
 * LLM-powered relevance ranking for job search results.
 *
 * Runs AFTER strict deterministic filtering. Uses the existing LlmService to
 * generate a relevance score and match explanation for each job. Hard
 * constraints are enforced by the filter module — this never overrides them.
 *
 * Follows the same pattern as scorer.ts.
 */

import { logger } from "@infra/logger";
import type {
  CreateJobInput,
  JobSearchResultItem,
  ParsedSearchSpec,
} from "@shared/types";
import { LlmService } from "../llm/service";
import type { JsonSchemaDefinition } from "../llm/types";
import { resolveLlmModel } from "../modelSelection";
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

const RANKING_CONCURRENCY = 4;

/**
 * Score a single job's relevance against the search spec using the LLM.
 */
async function scoreJobRelevance(
  job: CreateJobInput,
  spec: ParsedSearchSpec,
  verifiedConstraints: string[],
  unverifiedConstraints: string[],
): Promise<{ score: number; explanation: string }> {
  const model = await resolveLlmModel("default");

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
- Work mode: ${job.isRemote ? "remote" : (job.workFromHomeType ?? "not specified")}
- Experience range: ${job.experienceRange ?? "not specified"}
- Job type: ${job.jobType ?? "not specified"}
- Skills: ${job.skills ?? "not specified"}
- Description: ${(job.jobDescription ?? "").slice(0, 1000)}

Score 0-100 based on: title match (0-30), skills match (0-25), location/work-mode (0-20), experience (0-15), semantic similarity of description to query (0-10).

Respond with ONLY valid JSON: {"score": <integer 0-100>, "explanation": "<1-2 sentences referencing specific matched constraints>"}`;

  const llm = new LlmService();
  const result = await llm.callJson<{ score: number; explanation: string }>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: RELEVANCE_SCHEMA,
    maxRetries: 1,
    timeoutMs: 30_000,
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
 * Rank filtered jobs by relevance using LLM scoring.
 * Returns results sorted by relevance score descending.
 */
export async function rankJobs(
  filterResults: FilterResult[],
  spec: ParsedSearchSpec,
): Promise<JobSearchResultItem[]> {
  const passed = filterResults.filter((r) => r.passed);

  // Score jobs with bounded concurrency.
  const scored: Array<{
    filter: FilterResult;
    score: number;
    explanation: string;
  }> = [];

  for (let i = 0; i < passed.length; i += RANKING_CONCURRENCY) {
    const batch = passed.slice(i, i + RANKING_CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (filterResult) => {
        const { score, explanation } = await scoreJobRelevance(
          filterResult.job,
          spec,
          filterResult.verifiedConstraints,
          filterResult.unverifiedConstraints,
        );
        return { filter: filterResult, score, explanation };
      }),
    );
    scored.push(...batchResults);
  }

  scored.sort((a, b) => b.score - a.score);

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
