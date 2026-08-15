/**
 * Meta-search adapter types (ADR-008 SE-001).
 *
 * A meta-search adapter queries an external search aggregator (SerpAPI,
 * SearXNG, Brave) to discover jobs beyond the registered extractor manifests.
 */

import type { CreateJobInput } from "@shared/types";

export interface MetaSearchParams {
  /** Search terms derived from the parsed spec roles/skills. */
  terms: string[];
  /** Location constraints. */
  location: { country: string | null; cities: string[] };
  /** Work mode preference. */
  workMode: "remote" | "hybrid" | "onsite" | "any";
  /** Maximum pages to fetch (each page ≈ 10 results). */
  maxPages: number;
  /** Per-adapter timeout in milliseconds. */
  timeoutMs: number;
}

export interface MetaSearchResult {
  /** Adapter that produced these results. */
  adapterId: string;
  /** Display name of the adapter. */
  displayName: string;
  /** Discovered jobs. */
  jobs: CreateJobInput[];
  /** Whether the adapter completed successfully. */
  status: "succeeded" | "failed";
  /** Error message on failure. */
  error: string | null;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
}

export interface MetaSearchAdapter {
  /** Unique adapter identifier. */
  readonly id: string;
  /** Human-readable name for UI display. */
  readonly displayName: string;
  /** Check whether this adapter's prerequisites (API keys, URLs) are met. */
  available(): Promise<boolean>;
  /** Run a paginated search, yielding pages of results for streaming. */
  search(params: MetaSearchParams): AsyncGenerator<CreateJobInput[], void>;
}
