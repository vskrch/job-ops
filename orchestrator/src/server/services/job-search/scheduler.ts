/**
 * Resource-aware scheduler for job search manifest tasks (ADR-002).
 *
 * Enforces three independent bounds:
 * - A process-wide active-search limit (bounded FIFO wait queue).
 * - A per-search manifest concurrency limit.
 * - Per-resource-group semaphores (browser, subprocess, rate-limited, ...).
 *
 * Tasks are settled: an unexpected exception becomes a structured failure
 * result instead of aborting unrelated work.
 */

import { logger } from "@infra/logger";
import { asyncPool } from "@server/utils/async-pool";
import type {
  SearchManifestResult,
  SearchManifestTask,
  SearchResourceGroup,
} from "@shared/types";

// ---------------------------------------------------------------------------
// Process-wide active search limit
// ---------------------------------------------------------------------------

let activeSearchCount = 0;
const searchWaiters: Array<() => void> = [];

export function getActiveSearchCount(): number {
  return activeSearchCount;
}

/**
 * Acquire a process-wide search slot. Waits in a bounded FIFO queue when at
 * capacity. Throws when the queue is full so the caller can fail fast.
 */
export async function acquireSearchSlot(
  maxActive: number,
): Promise<() => void> {
  const safeMax = Math.max(1, maxActive);
  if (activeSearchCount < safeMax) {
    activeSearchCount += 1;
    return releaseSearchSlot;
  }

  const MAX_WAITERS = 3;
  if (searchWaiters.length >= MAX_WAITERS) {
    throw new Error(
      `Search capacity reached (${safeMax} active, ${MAX_WAITERS} queued). Try again shortly.`,
    );
  }

  await new Promise<void>((resolve) => {
    searchWaiters.push(resolve);
  });
  activeSearchCount += 1;
  return releaseSearchSlot;
}

function releaseSearchSlot(): void {
  activeSearchCount = Math.max(0, activeSearchCount - 1);
  const next = searchWaiters.shift();
  if (next) {
    next();
  }
}

// ---------------------------------------------------------------------------
// Resource-group semaphores
// ---------------------------------------------------------------------------

interface GroupState {
  active: number;
  waiters: Array<() => void>;
}

const groupStates = new Map<SearchResourceGroup, GroupState>();

function acquireGroupSlot(
  group: SearchResourceGroup,
  maxConcurrency: number,
): Promise<() => void> {
  const state = groupStates.get(group) ?? { active: 0, waiters: [] };
  groupStates.set(group, state);

  if (state.active < Math.max(1, maxConcurrency)) {
    state.active += 1;
    return Promise.resolve(() => releaseGroupSlot(group));
  }

  return new Promise<() => void>((resolve) => {
    state.waiters.push(() => {
      state.active += 1;
      resolve(() => releaseGroupSlot(group));
    });
  });
}

function releaseGroupSlot(group: SearchResourceGroup): void {
  const state = groupStates.get(group);
  if (!state) return;
  state.active = Math.max(0, state.active - 1);
  const next = state.waiters.shift();
  if (next) {
    next();
  } else if (state.active === 0 && state.waiters.length === 0) {
    groupStates.delete(group);
  }
}

/** Reset module state (tests). */
export function __resetSchedulerStateForTests(): void {
  activeSearchCount = 0;
  searchWaiters.length = 0;
  groupStates.clear();
}

// ---------------------------------------------------------------------------
// Per-search task execution
// ---------------------------------------------------------------------------

export interface RunManifestTasksOptions {
  tasks: SearchManifestTask[];
  perSearchConcurrency: number;
  onTaskStarted?: (task: SearchManifestTask) => void;
  onTaskSettled?: (result: SearchManifestResult) => void;
  task: (task: SearchManifestTask) => Promise<SearchManifestResult>;
}

/**
 * Run all planned manifest tasks with bounded concurrency. Individual task
 * failures never abort the pool; each result is a settled structure.
 */
export async function runManifestTasks(
  options: RunManifestTasksOptions,
): Promise<SearchManifestResult[]> {
  const { tasks, perSearchConcurrency, onTaskStarted, onTaskSettled, task } =
    options;
  if (tasks.length === 0) return [];

  const safeConcurrency = Math.max(1, Math.min(6, perSearchConcurrency));

  const results = await asyncPool({
    items: tasks,
    concurrency: safeConcurrency,
    task: async (plannedTask) => {
      onTaskStarted?.(plannedTask);
      const releaseGroup = await acquireGroupSlot(
        plannedTask.resourceGroup,
        plannedTask.maxConcurrency,
      );
      try {
        const result = await task(plannedTask);
        onTaskSettled?.(result);
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.warn("Manifest task aborted unexpectedly", {
          manifestId: plannedTask.manifestId,
          error: message,
        });
        const settled: SearchManifestResult = {
          manifestId: plannedTask.manifestId,
          displayName: plannedTask.displayName,
          selectedSources: plannedTask.selectedSources,
          jobs: [],
          status: "failed",
          error: message,
          durationMs: 0,
        };
        onTaskSettled?.(settled);
        return settled;
      } finally {
        releaseGroup();
      }
    },
  });

  return results;
}
