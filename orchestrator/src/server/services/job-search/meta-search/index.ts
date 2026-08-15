/**
 * Meta-search adapter registry (ADR-008 SE-001).
 *
 * Priority-based selection of available meta-search adapters. Returns
 * adapters in priority order; callers iterate and use the first available.
 */

import { logger } from "@infra/logger";
import { duckDuckGoAdapter } from "./duckduckgo";
import { freeAggregatorsAdapter } from "./free-aggregators";
import { serpApiAdapter } from "./serpapi";
import type {
  MetaSearchAdapter,
  MetaSearchParams,
  MetaSearchResult,
} from "./types";

/** All known adapters in priority order. Free & zero-cost adapters are prioritized. */
const ALL_ADAPTERS: MetaSearchAdapter[] = [
  duckDuckGoAdapter,
  freeAggregatorsAdapter,
  serpApiAdapter,
];

/**
 * Return the list of meta-search adapters whose prerequisites are met
 * (API keys, URLs). Result is ordered by priority.
 */
export async function getAvailableMetaAdapters(): Promise<MetaSearchAdapter[]> {
  const available: MetaSearchAdapter[] = [];
  for (const adapter of ALL_ADAPTERS) {
    try {
      if (await adapter.available()) {
        available.push(adapter);
      }
    } catch (error) {
      logger.debug("Meta-search adapter availability check failed", {
        adapterId: adapter.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return available;
}

/**
 * Run a single meta-search adapter, collecting all pages into a single
 * MetaSearchResult. Used by the source runner when dispatching meta-search tasks.
 */
export async function runMetaSearchAdapter(
  adapter: MetaSearchAdapter,
  params: MetaSearchParams,
): Promise<MetaSearchResult> {
  const startedAt = Date.now();
  try {
    const allJobs: import("@shared/types").CreateJobInput[] = [];
    for await (const page of adapter.search(params)) {
      allJobs.push(...page);
    }
    return {
      adapterId: adapter.id,
      displayName: adapter.displayName,
      jobs: allJobs,
      status: "succeeded",
      error: null,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.warn("Meta-search adapter failed", {
      adapterId: adapter.id,
      error: message,
    });
    return {
      adapterId: adapter.id,
      displayName: adapter.displayName,
      jobs: [],
      status: "failed",
      error: message,
      durationMs: Date.now() - startedAt,
    };
  }
}

export type { MetaSearchAdapter, MetaSearchParams, MetaSearchResult };
