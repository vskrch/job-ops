/**
 * Tests for the resource-aware scheduler (ADR-002).
 */

import type { SearchManifestTask } from "@shared/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetSchedulerStateForTests,
  acquireSearchSlot,
  getActiveSearchCount,
  runManifestTasks,
} from "./scheduler";

function makeTask(
  manifestId: string,
  group: SearchManifestTask["resourceGroup"] = "api-light",
): SearchManifestTask {
  return {
    manifestId,
    displayName: manifestId,
    selectedSources: [manifestId],
    resourceGroup: group,
    maxConcurrency: 1,
    timeoutMs: 10_000,
    status: "planned",
  };
}

beforeEach(() => {
  __resetSchedulerStateForTests();
});

describe("runManifestTasks", () => {
  it("bounded per-search concurrency is respected", async () => {
    const tasks = Array.from({ length: 6 }, (_, i) => makeTask(`m${i}`));
    let inFlight = 0;
    let maxInFlight = 0;

    const results = await runManifestTasks({
      tasks,
      perSearchConcurrency: 2,
      task: async (task) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10));
        inFlight -= 1;
        return {
          manifestId: task.manifestId,
          displayName: task.manifestId,
          selectedSources: task.selectedSources,
          jobs: [],
          status: "succeeded" as const,
          error: null,
          durationMs: 1,
        };
      },
    });

    expect(maxInFlight).toBeLessThanOrEqual(2);
    expect(results).toHaveLength(6);
    expect(results.every((r) => r.status === "succeeded")).toBe(true);
  });

  it("settles unexpected task exceptions without aborting other tasks", async () => {
    const results = await runManifestTasks({
      tasks: [makeTask("bad"), makeTask("good")],
      perSearchConcurrency: 2,
      task: async (task) => {
        if (task.manifestId === "bad") {
          throw new Error("boom");
        }
        return {
          manifestId: task.manifestId,
          displayName: task.manifestId,
          selectedSources: task.selectedSources,
          jobs: [],
          status: "succeeded" as const,
          error: null,
          durationMs: 1,
        };
      },
    });

    expect(results).toHaveLength(2);
    const bad = results.find((r) => r.manifestId === "bad");
    const good = results.find((r) => r.manifestId === "good");
    expect(bad?.status).toBe("failed");
    expect(bad?.error).toBe("boom");
    expect(good?.status).toBe("succeeded");
  });

  it("serializes tasks in a resource group with maxConcurrency 1", async () => {
    const tasks = [makeTask("b1", "browser"), makeTask("b2", "browser")];
    let inFlight = 0;
    let maxInFlight = 0;

    await runManifestTasks({
      tasks,
      perSearchConcurrency: 2,
      task: async (task) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return {
          manifestId: task.manifestId,
          displayName: task.manifestId,
          selectedSources: task.selectedSources,
          jobs: [],
          status: "succeeded" as const,
          error: null,
          durationMs: 1,
        };
      },
    });

    expect(maxInFlight).toBe(1);
  });

  it("runs empty task lists without error", async () => {
    const results = await runManifestTasks({
      tasks: [],
      perSearchConcurrency: 3,
      task: async () => {
        throw new Error("should not run");
      },
    });
    expect(results).toEqual([]);
  });
});

describe("acquireSearchSlot", () => {
  it("allows one active search at a time with a waiting queue", async () => {
    const release1 = await acquireSearchSlot(1);
    expect(getActiveSearchCount()).toBe(1);

    let release2: (() => void) | undefined;
    const second = acquireSearchSlot(1).then((r) => {
      release2 = r;
    });

    // The second acquisition must wait until the first slot is released.
    await new Promise((r) => setTimeout(r, 20));
    expect(release2).toBeUndefined();

    release1();
    await second;
    expect(getActiveSearchCount()).toBe(1);
    if (release2) release2();
    expect(getActiveSearchCount()).toBe(0);
  });

  it("fails fast when the wait queue is full", async () => {
    const release1 = await acquireSearchSlot(1);
    expect(getActiveSearchCount()).toBe(1);

    // Fill the 3-slot wait queue (these promises stay pending).
    acquireSearchSlot(1).catch(() => {});
    acquireSearchSlot(1).catch(() => {});
    acquireSearchSlot(1).catch(() => {});

    // The 4th must reject immediately without waiting.
    await expect(acquireSearchSlot(1)).rejects.toThrow(/capacity/i);

    // Clean up: reset module state for subsequent tests.
    release1();
    __resetSchedulerStateForTests();
  });
});
