/**
 * Search accumulator (ADR-002): single owner of mutable search state.
 *
 * Source completions are ingested serially through an internal promise chain,
 * so provisional snapshots and event ordering are deterministic even when
 * multiple manifests complete concurrently. The final result set is computed
 * over a canonical key-sorted view, making it invariant to completion order.
 */

import type {
  CreateJobInput,
  JobSearchResultItem,
  ParsedSearchSpec,
  SearchManifestResult,
} from "@shared/types";
import { deduplicateJobs } from "./dedup";
import { type FilterResult, filterJobs } from "./filter";

export interface SearchAccumulatorSnapshot {
  resultVersion: number;
  discovered: number;
  afterFilter: number;
  duplicatesRemoved: number;
  items: JobSearchResultItem[];
}

const PROVISIONAL_EXPLANATION =
  "Provisional result — awaiting final relevance ranking.";

export class SearchAccumulator {
  private readonly jobs: CreateJobInput[] = [];
  private readonly evaluationTime: string;
  private resultVersionValue = 0;
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly spec: ParsedSearchSpec) {
    this.evaluationTime = new Date().toISOString();
  }

  get evaluationTimeValue(): string {
    return this.evaluationTime;
  }

  get resultVersion(): number {
    return this.resultVersionValue;
  }

  /**
   * Serialize an operation against accumulator state. All mutation and
   * snapshot work must go through this so concurrent completions cannot
   * interleave read-modify-write sequences.
   */
  enqueue(operation: () => Promise<void> | void): Promise<void> {
    this.chain = this.chain.then(operation);
    return this.chain;
  }

  ingest(result: SearchManifestResult): void {
    if (result.status === "succeeded") {
      this.jobs.push(...result.jobs);
    }
  }

  /**
   * Deterministic snapshot of the current accumulated state: dedup + strict
   * filter over what has arrived so far. Provisional results are never LLM
   * scored — scoring happens once, on the final reconciled set.
   */
  snapshot(): SearchAccumulatorSnapshot {
    const deduped = deduplicateJobs(this.jobs);
    const filterResults = filterJobs(
      deduped.jobs.map(({ sources: _sources, ...job }) => job),
      this.spec,
    );
    const passed = filterResults.filter((r) => r.passed);

    const sourceMap = new Map(deduped.jobs.map((j) => [j.jobUrl, j.sources]));
    const items: JobSearchResultItem[] = passed.map((filterResult) => ({
      job: filterResult.job,
      sources: sourceMap.get(filterResult.job.jobUrl) ?? [
        filterResult.job.source,
      ],
      relevanceScore: 0,
      matchExplanation: PROVISIONAL_EXPLANATION,
      verifiedConstraints: filterResult.verifiedConstraints,
      unverifiedConstraints: filterResult.unverifiedConstraints,
      filteredOut: false,
      filterReason: null,
    }));

    this.resultVersionValue += 1;

    return {
      resultVersion: this.resultVersionValue,
      discovered: this.jobs.length,
      afterFilter: items.length,
      duplicatesRemoved: deduped.duplicatesRemoved,
      items,
    };
  }

  /** Number of jobs ingested so far (pre-dedup). */
  totalDiscovered(): number {
    return this.jobs.length;
  }

  /** Final canonical job list for authoritative dedup + filter + ranking.
   * Sorted by source then URL so the final result is invariant to the order
   * in which manifests completed.
   */
  finalJobs(): CreateJobInput[] {
    return [...this.jobs].sort((a, b) => {
      const sourceCmp = a.source.localeCompare(b.source);
      if (sourceCmp !== 0) return sourceCmp;
      return a.jobUrl.localeCompare(b.jobUrl);
    });
  }

  /** Final filtered view over the canonical set (for the report). */
  finalFiltered(): {
    deduped: Array<CreateJobInput & { sources: string[] }>;
    filterResults: FilterResult[];
  } {
    const dedupResult = deduplicateJobs(this.finalJobs());
    const filterResults = filterJobs(
      dedupResult.jobs.map(({ sources: _sources, ...job }) => job),
      this.spec,
    );
    return { deduped: dedupResult.jobs, filterResults };
  }
}
