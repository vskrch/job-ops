import { runWithRequestContext } from "@infra/request-context";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetPipelineOrchestratorForTests,
  getPipelineStatus,
  requestPipelineCancel,
  runPipeline,
} from "./orchestrator";
import {
  __resetProgressForTests,
  getProgress,
  subscribeToProgress,
  updateProgress,
} from "./progress";

type DiscoverResult = { discoveredJobs: []; sourceErrors: [] };

const stepState = vi.hoisted(() => {
  const resolvers: Array<(val: DiscoverResult) => void> = [];
  return {
    addResolver: (fn: (val: DiscoverResult) => void) => {
      resolvers.push(fn);
    },
    count: () => resolvers.length,
    resolveAll: (val: DiscoverResult) => {
      while (resolvers.length > 0) {
        const fn = resolvers.shift();
        fn?.(val);
      }
    },
  };
});

vi.mock("../repositories/pipeline", () => {
  const runs: Array<{
    id: string;
    userId: string;
    status: string;
    startedAt: string;
  }> = [];
  return {
    createPipelineRun: vi.fn(async (_config) => {
      const { getCurrentUserId } = await import("@infra/request-context");
      const userId = getCurrentUserId();
      const run = {
        id: `run-${userId}-${Math.random().toString(36).slice(2, 7)}`,
        userId,
        startedAt: new Date().toISOString(),
        completedAt: null,
        status: "running",
        jobsDiscovered: 0,
        jobsProcessed: 0,
        errorMessage: null,
        config: null,
      };
      runs.push(run);
      return run;
    }),
    updatePipelineRun: vi.fn(async (id, update) => {
      const match = runs.find((r) => r.id === id);
      if (match) {
        Object.assign(match, update);
      }
    }),
    getRecentPipelineRuns: vi.fn(async () => {
      const { getCurrentUserId } = await import("@infra/request-context");
      const userId = getCurrentUserId();
      return runs.filter((r) => r.userId === userId);
    }),
    getLatestPipelineRun: vi.fn(async () => {
      const { getCurrentUserId } = await import("@infra/request-context");
      const userId = getCurrentUserId();
      const userRuns = runs.filter((r) => r.userId === userId);
      return userRuns[userRuns.length - 1] ?? null;
    }),
  };
});

vi.mock("./steps", () => ({
  loadProfileStep: vi.fn(async () => ({})),
  discoverJobsStep: vi.fn(
    ({ shouldCancel }: { shouldCancel?: () => boolean }) =>
      new Promise<{ discoveredJobs: []; sourceErrors: [] }>((resolve) => {
        if (shouldCancel?.()) {
          resolve({ discoveredJobs: [], sourceErrors: [] });
          return;
        }
        stepState.addResolver(resolve);
      }),
  ),
  importJobsStep: vi.fn(async () => ({ created: 0, skipped: 0 })),
  scoreJobsStep: vi.fn(async () => ({ unprocessedJobs: [], scoredJobs: [] })),
  selectJobsStep: vi.fn(() => []),
  processJobsStep: vi.fn(async () => ({ processedCount: 0 })),
  notifyPipelineWebhookStep: vi.fn(async () => undefined),
}));

describe("multi-tenant pipeline isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetProgressForTests();
    __resetPipelineOrchestratorForTests();
  });

  it("isolates live SSE progress events between users", () => {
    const eventsUserA: string[] = [];
    const eventsUserB: string[] = [];

    const unsubA = subscribeToProgress((p) => {
      eventsUserA.push(p.message);
    }, "user-alice");

    const unsubB = subscribeToProgress((p) => {
      eventsUserB.push(p.message);
    }, "user-bob");

    // Alice progresses
    updateProgress(
      { step: "crawling", message: "Alice searching Indeed..." },
      "user-alice",
    );

    expect(eventsUserA).toContain("Alice searching Indeed...");
    expect(eventsUserB).not.toContain("Alice searching Indeed...");
    expect(getProgress("user-alice").step).toBe("crawling");
    expect(getProgress("user-bob").step).toBe("idle");

    // Bob progresses
    updateProgress(
      { step: "scoring", message: "Bob AI scoring jobs..." },
      "user-bob",
    );

    expect(eventsUserB).toContain("Bob AI scoring jobs...");
    expect(eventsUserA).not.toContain("Bob AI scoring jobs...");
    expect(getProgress("user-bob").step).toBe("scoring");

    unsubA();
    unsubB();
  });

  it("allows multiple users to run pipelines concurrently and isolates cancellation", async () => {
    const pipelineRepo = await import("../repositories/pipeline");

    // Start Alice's pipeline
    const aliceRunPromise = runWithRequestContext(
      { userId: "user-alice" },
      () => runPipeline({ sources: [] }, "user-alice"),
    );

    // Start Bob's pipeline concurrently
    const bobRunPromise = runWithRequestContext({ userId: "user-bob" }, () =>
      runPipeline({ sources: [] }, "user-bob"),
    );

    // Wait until both runs are created in repository
    await vi.waitFor(() => {
      expect(pipelineRepo.createPipelineRun).toHaveBeenCalledTimes(2);
    });

    // Verify both are running concurrently
    expect(getPipelineStatus("user-alice").isRunning).toBe(true);
    expect(getPipelineStatus("user-bob").isRunning).toBe(true);
    expect(getPipelineStatus("user-charlie").isRunning).toBe(false);

    // Alice requests cancellation
    const aliceCancel = requestPipelineCancel(undefined, "user-alice");
    expect(aliceCancel.accepted).toBe(true);

    // Wait until discover steps are waiting and resolve
    await vi.waitFor(() => {
      expect(stepState.count()).toBeGreaterThanOrEqual(1);
    });
    stepState.resolveAll({ discoveredJobs: [], sourceErrors: [] });

    const aliceResult = await aliceRunPromise;
    const bobResult = await bobRunPromise;

    // Alice should be cancelled
    expect(aliceResult.success).toBe(false);
    expect(aliceResult.error).toContain("Cancelled");

    // Bob should have completed successfully without interference
    expect(bobResult.success).toBe(true);

    // Statuses update independently
    expect(getPipelineStatus("user-alice").isRunning).toBe(false);
    expect(getPipelineStatus("user-bob").isRunning).toBe(false);
  });
});
