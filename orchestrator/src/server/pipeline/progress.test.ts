import { afterEach, describe, expect, it } from "vitest";
import {
  getProgress,
  resetProgress,
  subscribeToProgress,
  updateProgress,
} from "./progress";

afterEach(() => {
  resetProgress();
});

describe("pipeline progress replay buffer", () => {
  it("replays buffered events to a late subscriber", () => {
    const earlyEvents: string[] = [];
    const lateEvents: string[] = [];

    // Subscribe early
    const unsubEarly = subscribeToProgress((p) => {
      earlyEvents.push(p.step);
    });

    // Emit some events
    updateProgress({ step: "crawling", message: "Crawling..." });
    updateProgress({ step: "importing", message: "Importing..." });
    updateProgress({ step: "scoring", message: "Scoring..." });

    // Unsubscribe early listener
    unsubEarly();

    // Subscribe late — should receive replay of all buffered events
    const unsubLate = subscribeToProgress((p) => {
      lateEvents.push(p.step);
    });

    try {
      // The late subscriber should have received all replayed steps
      // (idle from reset, then crawling, importing, scoring)
      expect(lateEvents.length).toBeGreaterThanOrEqual(3);
      expect(lateEvents).toContain("crawling");
      expect(lateEvents).toContain("importing");
      expect(lateEvents).toContain("scoring");
    } finally {
      unsubLate();
    }
  });

  it("notifies live listeners of new events after subscription", () => {
    const events: string[] = [];
    const unsub = subscribeToProgress(() => {});

    updateProgress({ step: "crawling", message: "Crawling..." });

    const unsub2 = subscribeToProgress((p) => {
      events.push(p.step);
    });

    // Emit a new event after the second subscriber joined
    updateProgress({ step: "scoring", message: "Scoring..." });

    try {
      // The second subscriber should have received replay + the new event
      expect(events).toContain("scoring");
    } finally {
      unsub();
      unsub2();
    }
  });

  it("clears the replay buffer on resetProgress", () => {
    updateProgress({ step: "crawling", message: "Crawling..." });
    updateProgress({ step: "scoring", message: "Scoring..." });

    resetProgress();

    const events: string[] = [];
    const unsub = subscribeToProgress((p) => {
      events.push(p.step);
    });

    try {
      // After reset, the replay buffer is empty — no events are replayed.
      expect(events).toEqual([]);
      // But getProgress still reflects the idle state.
      expect(getProgress().step).toBe("idle");
    } finally {
      unsub();
    }
  });

  it("caps the replay buffer at MAX_REPLAY_EVENTS", () => {
    // Emit more than 100 events
    for (let i = 0; i < 120; i++) {
      updateProgress({ step: "scoring", message: `Scoring ${i}` });
    }

    const events: string[] = [];
    const unsub = subscribeToProgress((p) => {
      events.push(p.message);
    });

    try {
      // The replay buffer should be capped at 100 events
      expect(events.length).toBeLessThanOrEqual(100);
    } finally {
      unsub();
    }
  });

  it("getProgress returns the current progress snapshot", () => {
    updateProgress({
      step: "crawling",
      message: "Crawling...",
      jobsDiscovered: 42,
    });

    const progress = getProgress();
    expect(progress.step).toBe("crawling");
    expect(progress.jobsDiscovered).toBe(42);
  });
});
