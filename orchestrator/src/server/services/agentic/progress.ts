import type { AgenticProgressEvent } from "@shared/types";

type AgenticListener = (event: AgenticProgressEvent) => void;

/** Distributes Omit across the event union so callers can omit `sequence`/`searchId`. */
export type AgenticProgressEventInput = AgenticProgressEvent extends infer E
  ? E extends { type: string }
    ? Omit<E, "sequence" | "searchId">
    : never
  : never;

const listenersBySearch = new Map<string, Set<AgenticListener>>();
const replayBySearch = new Map<string, AgenticProgressEvent[]>();
const sequenceBySearch = new Map<string, number>();

const MAX_REPLAY_EVENTS = 100;

export function subscribeToAgenticSearchProgress(
  searchId: string,
  listener: AgenticListener,
): () => void {
  let listeners = listenersBySearch.get(searchId);
  if (!listeners) {
    listeners = new Set();
    listenersBySearch.set(searchId, listeners);
  }
  listeners.add(listener);

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
        replayBySearch.delete(searchId);
        sequenceBySearch.delete(searchId);
      }
    }
  };
}

export function emitAgenticProgress(
  searchId: string,
  event: AgenticProgressEventInput,
): void {
  const seq = (sequenceBySearch.get(searchId) ?? 0) + 1;
  sequenceBySearch.set(searchId, seq);

  const full = { ...event, searchId, sequence: seq } as AgenticProgressEvent;

  let replay = replayBySearch.get(searchId);
  if (!replay) {
    replay = [];
    replayBySearch.set(searchId, replay);
  }
  replay.push(full);
  if (replay.length > MAX_REPLAY_EVENTS) replay.shift();

  const listeners = listenersBySearch.get(searchId);
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(full);
      } catch {
        listeners.delete(listener);
      }
    }
  }
}

export function clearAgenticSearchProgress(searchId: string): void {
  listenersBySearch.delete(searchId);
  replayBySearch.delete(searchId);
  sequenceBySearch.delete(searchId);
}
