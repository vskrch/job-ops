/**
 * Job search progress tracking with Server-Sent Events (ADR-002).
 *
 * Every event carries a monotonic per-search sequence so clients can detect
 * gaps and reconcile via GET /api/job-search/:id. A bounded replay buffer
 * lets late or reconnecting subscribers catch up on missed events.
 */

import { logger } from "@infra/logger";
import type { JobSearchProgressEvent } from "@shared/types";

type SearchListener = (event: JobSearchProgressEvent) => void;

/** Distributes Omit across the event union so callers can omit `sequence`. */
export type JobSearchProgressEventInput = JobSearchProgressEvent extends infer E
  ? E extends { type: string }
    ? Omit<E, "sequence">
    : never
  : never;

const listenersBySearch = new Map<string, Set<SearchListener>>();
const latestEventBySearch = new Map<string, JobSearchProgressEvent>();
const replayBySearch = new Map<string, JobSearchProgressEvent[]>();
const sequenceBySearch = new Map<string, number>();

const MAX_REPLAY_EVENTS = 100;

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

  // Replay buffered events in order so late subscribers reconstruct state.
  const replay = replayBySearch.get(searchId);
  if (replay) {
    for (const event of replay) {
      listener(event);
    }
  }

  return () => {
    const set = listenersBySearch.get(searchId);
    if (set) {
      set.delete(listener);
      if (set.size === 0) {
        listenersBySearch.delete(searchId);
        latestEventBySearch.delete(searchId);
        replayBySearch.delete(searchId);
        sequenceBySearch.delete(searchId);
      }
    }
  };
}

/**
 * Emit a progress event, attaching the next monotonic sequence number.
 */
export function emitSearchProgress(event: JobSearchProgressEventInput): void {
  const searchId = event.searchId;
  const sequence = (sequenceBySearch.get(searchId) ?? 0) + 1;
  sequenceBySearch.set(searchId, sequence);

  const fullEvent = { ...event, sequence } as JobSearchProgressEvent;
  latestEventBySearch.set(searchId, fullEvent);

  const replay = replayBySearch.get(searchId) ?? [];
  replay.push(fullEvent);
  if (replay.length > MAX_REPLAY_EVENTS) {
    replay.splice(0, replay.length - MAX_REPLAY_EVENTS);
  }
  replayBySearch.set(searchId, replay);

  const listeners = listenersBySearch.get(searchId);
  if (!listeners) return;

  for (const listener of listeners) {
    try {
      listener(fullEvent);
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
  replayBySearch.delete(searchId);
  sequenceBySearch.delete(searchId);
}