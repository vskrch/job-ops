import type { JobSearchResults } from "./job-search";

/**
 * Agentic search status values (state machine).
 */
export const AGENTIC_SEARCH_STATUSES = [
  "created",
  "planning",
  "searching",
  "normalizing",
  "deduplicating",
  "filtering",
  "evaluating",
  "verifying",
  "refining",
  "ranking",
  "reporting",
  "completed",
  "failed",
  "partial",
  "cancelled",
  "timed_out",
] as const;

export type AgenticSearchStatus = (typeof AGENTIC_SEARCH_STATUSES)[number];

/**
 * A constraint value with explicit/inferred source and hard/soft classification.
 */
export interface ConstraintValue {
  value: unknown;
  source: "explicit" | "inferred";
  hard: boolean;
}

/**
 * The agent's understanding of the user's search goal.
 */
export interface AgenticGoal {
  summary: string;
  searchTerms: string[];
  expandedTerms: string[];
  expansionReason: string | null;
}

/**
 * Budget usage tracking for a single agentic search.
 */
export interface BudgetUsage {
  llmCalls: number;
  totalTokens: number;
  estimatedCost: number;
  elapsedMs: number;
}

/**
 * Budget limits for a single agentic search.
 */
export interface BudgetLimits {
  maxLlmCalls: number;
  maxTotalTokens: number;
  maxEstimatedCost: number;
  maxElapsedMs: number;
  maxIterations: number;
  maxVerificationCalls: number;
}

/**
 * A stored agentic search record.
 */
export interface AgenticSearch {
  id: string;
  originalQuery: string;
  queryHash: string;
  status: AgenticSearchStatus;
  goal: AgenticGoal | null;
  hardConstraints: Record<string, ConstraintValue> | null;
  softPreferences: Record<string, ConstraintValue> | null;
  searchPlan: AgenticSearchPlan | null;
  currentStep: string | null;
  iterationCount: number;
  maxIterations: number;
  results: JobSearchResults | null;
  budgetUsed: BudgetUsage | null;
  searchExpansions: SearchExpansion[] | null;
  startedAt: string | null;
  completedAt: string | null;
  failureReason: string | null;
  fallbackSearchId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * A planned step in the agentic search.
 */
export interface AgenticSearchPlan {
  steps: AgenticPlanStep[];
}

export interface AgenticPlanStep {
  id: string;
  action: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

/**
 * Search term expansion record for transparency.
 */
export interface SearchExpansion {
  originalTerms: string[];
  expandedTerms: string[];
  reason: string;
  iteration: number;
}

/**
 * An audited tool call within an agentic search.
 */
export interface AgenticToolCall {
  id: string;
  searchId: string;
  toolName: string;
  argumentsSummary: string | null;
  resultSummary: string | null;
  status: "pending" | "running" | "completed" | "failed";
  latencyMs: number | null;
  iteration: number;
  createdAt: string;
}

/**
 * Status of a single constraint verification for a job.
 */
export type JobVerificationStatus =
  | "verified"
  | "not_verified"
  | "contradicted"
  | "unknown";

/**
 * A job verification result.
 */
export interface JobVerification {
  id: string;
  searchId: string | null;
  jobUrl: string;
  constraintKey: string;
  status: JobVerificationStatus;
  confidence: number | null;
  evidence: string | null;
  verifiedAt: string;
}

/**
 * Coverage evaluation result from the LLM.
 */
export interface CoverageEvaluation {
  sufficient: boolean;
  reason: string;
  suggestions: CoverageAction[];
}

export type CoverageAction =
  | { type: "expand_terms"; terms: string[] }
  | { type: "verify_unknowns"; jobUrls: string[]; constraint: string }
  | { type: "search_additional_sources"; sources: string[] }
  | { type: "done" };

/**
 * Verification result for a single job constraint.
 */
export interface VerificationResult {
  jobUrl: string;
  constraintKey: string;
  status: "verified" | "not_verified" | "contradicted" | "unknown";
  confidence: number;
  evidence: string;
}

/**
 * Progress events for agentic search SSE streaming.
 */
export type AgenticProgressEvent =
  | {
      type: "agentic_started";
      searchId: string;
      goal: AgenticGoal;
      sequence: number;
    }
  | {
      type: "agentic_step";
      searchId: string;
      step: AgenticSearchStatus;
      message: string;
      sequence: number;
    }
  | {
      type: "agentic_iteration";
      searchId: string;
      iteration: number;
      maxIterations: number;
      reason: string;
      sequence: number;
    }
  | {
      type: "agentic_verification";
      searchId: string;
      jobsVerifying: number;
      jobsVerified: number;
      sequence: number;
    }
  | {
      type: "agentic_expansion";
      searchId: string;
      expandedTerms: string[];
      reason: string;
      sequence: number;
    }
  | {
      type: "agentic_budget";
      searchId: string;
      budgetUsed: BudgetUsage;
      sequence: number;
    }
  | {
      type: "agentic_completed";
      searchId: string;
      results: JobSearchResults;
      sequence: number;
    }
  | {
      type: "agentic_failed";
      searchId: string;
      error: string;
      fallbackSearchId: string | null;
      sequence: number;
    };

/**
 * API request to create an agentic search.
 */
export interface CreateAgenticSearchRequest {
  query: string;
}

/**
 * API response for a created agentic search.
 */
export interface CreateAgenticSearchResponse {
  searchId: string;
  status: AgenticSearchStatus;
}

/**
 * API response for agentic search status.
 */
export interface AgenticSearchStatusResponse {
  id: string;
  status: AgenticSearchStatus;
  currentStep: string | null;
  iterationCount: number;
  maxIterations: number;
  jobsFound: number;
  jobsUnique: number;
  jobsMatching: number;
  budgetUsed: BudgetUsage | null;
  results: JobSearchResults | null;
}
