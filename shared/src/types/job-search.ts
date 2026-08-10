import type { CreateJobInput } from "./jobs";

/**
 * Structured search specification parsed from a natural-language query.
 *
 * Explicit constraints (user stated them) are kept separate from inferred
 * preferences so filtering logic can enforce strict matching on explicit
 * constraints while treating inferred ones as soft signals for ranking.
 */
export interface ParsedSearchSpec {
  /** Job titles / roles the user explicitly requested. */
  roles: string[];
  /** Skills / technologies mentioned. */
  skills: string[];
  /** Geographic constraints. */
  location: {
    country: string | null;
    cities: string[];
  };
  /** Work mode: remote, hybrid, onsite, or any. */
  workMode: "remote" | "hybrid" | "onsite" | "any";
  /** Employment type if specified. */
  employmentType: "full_time" | "part_time" | "contract" | null;
  /** Experience range in years. */
  experience: {
    minYears: number | null;
    maxYears: number | null;
  };
  /** Salary constraints. */
  salary: {
    min: number | null;
    max: number | null;
    currency: string | null;
  };
  /** Posting freshness window. */
  postedWithin: {
    /** Numeric value of the window (e.g. 24, 7). */
    value: number | null;
    /** Unit for the window. */
    unit: "hours" | "days" | "weeks" | null;
  };
  /** Terms to exclude (negative constraints). */
  excludeTerms: string[];
  /** Seniority level if specified. */
  seniority: string | null;
  /** Industry if specified. */
  industry: string | null;
  /** Human-readable explanation of how the query was interpreted. */
  interpretation: string;
  /** Confidence of the parsing. */
  confidence: "high" | "medium" | "low";
  /** Which constraints were explicitly stated vs. inferred. */
  explicitConstraints: string[];
  inferredPreferences: string[];
}

/**
 * A single job result within a search, with search-specific metadata.
 */
export interface JobSearchResultItem {
  /** The normalized job data. */
  job: CreateJobInput;
  /** Sources where this job was found (after dedup merging). */
  sources: string[];
  /** Relevance score 0-100. */
  relevanceScore: number;
  /** Human-readable match explanation. */
  matchExplanation: string;
  /** Constraints that were verified as matching. */
  verifiedConstraints: string[];
  /** Constraints that could not be verified (unknown). */
  unverifiedConstraints: string[];
  /** Whether the job failed a strict filter (should not appear in results). */
  filteredOut: boolean;
  /** Reason for filtering, if filtered out. */
  filterReason: string | null;
}

/**
 * Resource class used by the scheduler to bound concurrency per provider type.
 */
export type SearchResourceGroup =
  | "api-light"
  | "api-rate-limited"
  | "browser"
  | "subprocess-heavy"
  | "auth-single-flight"
  | "shared-storage";

/**
 * A planned manifest execution unit: one manifest, one selected source group,
 * one resource policy. Multi-source manifests are invoked exactly once.
 */
export interface SearchManifestTask {
  manifestId: string;
  displayName: string;
  selectedSources: string[];
  resourceGroup: SearchResourceGroup;
  maxConcurrency: number;
  timeoutMs: number;
  status: "planned" | "running" | "succeeded" | "failed" | "skipped";
}

/**
 * Result of running one manifest task.
 */
export interface SearchManifestResult {
  manifestId: string;
  displayName: string;
  selectedSources: string[];
  jobs: CreateJobInput[];
  status: "succeeded" | "failed" | "skipped";
  error: string | null;
  durationMs: number;
}

/**
 * Auditable execution plan for a search.
 */
export interface SearchSourcePlan {
  version: string;
  country: string | null;
  evaluationTime: string;
  tasks: SearchManifestTask[];
  skippedSources: Array<{ source: string; reason: string }>;
}

/**
 * Source (manifest) status during a search.
 */
export interface SearchSourceStatus {
  /** Manifest id. */
  source: string;
  /** Human-readable manifest name. */
  displayName: string;
  /** Source ids this manifest was asked to cover. */
  selectedSources: string[];
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  jobsFound: number;
  error: string | null;
}

/**
 * Freshness window information for the report.
 */
export interface FreshnessWindow {
  /** Original NL freshness expression (e.g. "last 24 hours"). */
  requested: string | null;
  /** Effective start of the window (ISO timestamp). */
  effectiveStart: string | null;
  /** Effective end of the window (ISO timestamp, usually search execution time). */
  effectiveEnd: string | null;
  /** Jobs removed by freshness filtering. */
  removedByFreshness: number;
}

/**
 * Complete search results snapshot.
 */
export interface JobSearchResults {
  /** All jobs discovered before filtering. */
  totalDiscovered: number;
  /** Jobs remaining after strict filtering. */
  totalAfterFilter: number;
  /** Duplicate jobs removed. */
  duplicatesRemoved: number;
  /** Jobs ranked as highly relevant (score >= 70). */
  highlyRelevant: number;
  /** Jobs with incomplete information (unverified constraints). */
  incompleteInfo: number;
  /** Ranked, filtered job results. */
  jobs: JobSearchResultItem[];
  /** Per-manifest status. */
  sources: SearchSourceStatus[];
  /** Freshness window details. */
  freshness: FreshnessWindow;
}

/**
 * Terminal status of a job search.
 */
export type JobSearchStatus = "running" | "completed" | "failed";

/**
 * Execution phase of a job search. `status` describes the terminal state;
 * `phase` describes current work for progress reporting and recovery.
 */
export type JobSearchPhase =
  | "queued"
  | "parsing"
  | "planning"
  | "aggregating"
  | "filtering"
  | "provisional_results"
  | "ranking"
  | "reporting"
  | "emailing"
  | "completed"
  | "failed";

/**
 * Email delivery status for a search.
 */
export type SearchEmailStatus = "pending" | "sent" | "failed" | "skipped";

/**
 * A stored job search record.
 */
export interface JobSearch {
  id: string;
  originalQuery: string;
  /** Synchronous admission identity computed before parsing. */
  admissionHash: string;
  /** Semantic hash of the parsed spec (post-parse). */
  specHash: string | null;
  parserVersion: string;
  sourcePlanVersion: string;
  parsedSpec: ParsedSearchSpec | null;
  phase: JobSearchPhase;
  status: JobSearchStatus;
  results: JobSearchResults | null;
  /** Monotonic snapshot version for partial/final result ordering. */
  resultVersion: number;
  sourcePlan: SearchSourcePlan | null;
  /** Frozen freshness boundary for the search. */
  evaluationTime: string | null;
  sourcesSearched: string[];
  sourcesSucceeded: string[];
  sourcesFailed: string[];
  searchStartedAt: string | null;
  searchCompletedAt: string | null;
  emailStatus: SearchEmailStatus;
  emailSentAt: string | null;
  emailError: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  lastProgressAt: string | null;
}

/**
 * Progress event sent over SSE during a search. Every event carries a
 * monotonic per-search sequence so clients can detect gaps and reconcile
 * via GET /api/job-search/:id.
 */
export type JobSearchProgressEvent =
  | {
      type: "phase";
      searchId: string;
      phase: JobSearchPhase;
      message: string;
      sequence: number;
    }
  | {
      type: "started";
      searchId: string;
      parsedSpec: ParsedSearchSpec;
      sourcesTotal: number;
      sequence: number;
    }
  | {
      type: "manifest_started";
      searchId: string;
      manifestId: string;
      displayName: string;
      selectedSources: string[];
      sourcesTotal: number;
      sequence: number;
    }
  | {
      type: "manifest_completed";
      searchId: string;
      manifestId: string;
      status: "succeeded" | "failed" | "skipped";
      jobsFound: number;
      error: string | null;
      sourcesCompleted: number;
      sourcesTotal: number;
      sequence: number;
    }
  | {
      type: "results_partial";
      searchId: string;
      resultVersion: number;
      provisional: true;
      results: JobSearchResultItem[];
      counts: {
        discovered: number;
        afterFilter: number;
        duplicatesRemoved: number;
      };
      sequence: number;
    }
  | {
      type: "completed";
      searchId: string;
      totalDiscovered: number;
      totalAfterFilter: number;
      duplicatesRemoved: number;
      results: JobSearchResultItem[];
      sources: SearchSourceStatus[];
      resultVersion: number;
      sequence: number;
    }
  | {
      type: "failed";
      searchId: string;
      error: string;
      sequence: number;
    }
  | {
      type: "email_sent";
      searchId: string;
      sequence: number;
    }
  | {
      type: "email_failed";
      searchId: string;
      error: string;
      sequence: number;
    }
  | {
      type: "email_skipped";
      searchId: string;
      reason: string;
      sequence: number;
    };

/**
 * API request to create a job search.
 */
export interface CreateJobSearchRequest {
  query: string;
  /** Force a fresh search, ignoring cache. */
  fresh?: boolean;
}

/**
 * API response for a created job search. The query parse runs in the
 * background, so parsedSpec is null here; it arrives via the SSE `started`
 * event or GET /api/job-search/:id.
 */
export interface CreateJobSearchResponse {
  searchId: string;
  status: JobSearchStatus;
  phase: JobSearchPhase;
  parsedSpec: ParsedSearchSpec | null;
  cached: boolean;
}

/**
 * API response listing job searches.
 */
export interface JobSearchListItem {
  id: string;
  originalQuery: string;
  status: JobSearchStatus;
  phase: JobSearchPhase;
  totalDiscovered: number;
  totalAfterFilter: number;
  emailStatus: SearchEmailStatus;
  createdAt: string;
  searchCompletedAt: string | null;
}
