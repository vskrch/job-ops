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
 * Source status during a search.
 */
export interface SearchSourceStatus {
  source: string;
  status: "pending" | "running" | "succeeded" | "failed";
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
  /** Per-source status. */
  sources: SearchSourceStatus[];
  /** Freshness window details. */
  freshness: FreshnessWindow;
}

/**
 * Status of a job search.
 */
export type JobSearchStatus = "running" | "completed" | "failed";

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
  queryHash: string;
  parsedSpec: ParsedSearchSpec | null;
  status: JobSearchStatus;
  results: JobSearchResults | null;
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
}

/**
 * Progress event sent over SSE during a search.
 */
export type JobSearchProgressEvent =
  | {
      type: "started";
      searchId: string;
      parsedSpec: ParsedSearchSpec;
      sourcesTotal: number;
    }
  | {
      type: "source_started";
      searchId: string;
      source: string;
      sourcesCompleted: number;
      sourcesTotal: number;
    }
  | {
      type: "source_completed";
      searchId: string;
      source: string;
      sourcesCompleted: number;
      sourcesTotal: number;
      jobsFound: number;
      status: "succeeded" | "failed";
      error: string | null;
    }
  | {
      type: "phase";
      searchId: string;
      phase:
        | "aggregating"
        | "deduplicating"
        | "filtering"
        | "ranking"
        | "emailing"
        | "completed";
      message: string;
      counts?: {
        discovered: number;
        afterFilter: number;
        duplicatesRemoved: number;
      };
    }
  | {
      type: "completed";
      searchId: string;
      totalDiscovered: number;
      totalAfterFilter: number;
      duplicatesRemoved: number;
      results: JobSearchResultItem[];
      sources: SearchSourceStatus[];
    }
  | {
      type: "failed";
      searchId: string;
      error: string;
    }
  | {
      type: "email_sent";
      searchId: string;
    }
  | {
      type: "email_failed";
      searchId: string;
      error: string;
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
 * API response for a created job search.
 */
export interface CreateJobSearchResponse {
  searchId: string;
  status: JobSearchStatus;
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
  totalDiscovered: number;
  totalAfterFilter: number;
  emailStatus: SearchEmailStatus;
  createdAt: string;
  searchCompletedAt: string | null;
}
