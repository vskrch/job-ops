/**
 * Job search progress tracking with Server-Sent Events.
 *
 * Follows the same in-memory listener pattern as pipeline/progress.ts
 * but is scoped per-search (multiple searches can run concurrently).
 */

import { logger } from "@infra/logger";
import type { JobSearchProgressEvent } from "@shared/types";

type SearchListener = (event: JobSearchProgressEvent) => void;

const listenersBySearch = new Map<string, Set<SearchListener>>();
const latestEventBySearch = new Map<string, JobSearchProgressEvent>();

export function subscribeToSearchProgress(
  searchId: string,
  listener: SearchListener,
): () => void {
  let listeners = listenersBySearch.get(searchId);
  if (!listeners) {
    listeners = new Set();
    listenersBySearch.set(searchId, listeners);
  }
  listeners.add(listener);

  const latest = latestEventBySearch.get(searchId);
  if (latest) listener(latest);

  return () => {
    const set = listenersBySearch.get(searchId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        listenersBySearch.delete(searchId);
        latestEventBySearch.delete(searchId);
      }
    }
  };
}

export function emitSearchProgress(event: JobSearchProgressEvent): void {
  const searchId = event.searchId;
  latestEventBySearch.set(searchId, event);

  const listeners = listenersBySearch.get(searchId);
  if (!listeners) return;

  for (const listener of listeners) {
    try {
      listener(event);
    } catch (error) {
      logger.error("Error in search progress listener", {
        searchId,
        error,
      });
    }
  }
}

export function clearSearchProgress(searchId: string): void {
  listenersBySearch.delete(searchId);
  latestEventBySearch.delete(searchId);
}
