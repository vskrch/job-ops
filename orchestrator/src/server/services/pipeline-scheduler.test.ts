import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/pipeline-schedules", () => ({
  listPipelineSchedules: vi.fn(),
  getEnabledSchedules: vi.fn(),
  createPipelineSchedule: vi.fn(),
  updatePipelineSchedule: vi.fn(),
  deletePipelineSchedule: vi.fn(),
  getPipelineScheduleById: vi.fn(),
}));

vi.mock("@server/pipeline/index", () => ({
  runPipeline: vi.fn().mockResolvedValue({
    success: true,
    jobsDiscovered: 5,
    jobsProcessed: 3,
  }),
}));

vi.mock("@infra/request-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@infra/request-context")>();
  return {
    ...actual,
    runWithRequestContext: vi.fn((_ctx: unknown, fn: () => Promise<unknown>) =>
      Promise.resolve(fn()),
    ),
  };
});

import { runPipeline } from "@server/pipeline/index";
import * as scheduleRepo from "@server/repositories/pipeline-schedules";
import {
  getPipelineSchedules,
  refreshPipelineScheduler,
} from "./pipeline-scheduler";

const mockGetEnabledSchedules = vi.mocked(scheduleRepo.getEnabledSchedules);
const mockListPipelineSchedules = vi.mocked(scheduleRepo.listPipelineSchedules);
const mockRunPipeline = vi.mocked(runPipeline);

describe("pipeline-scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));
    mockGetEnabledSchedules.mockReset();
    mockListPipelineSchedules.mockReset();
    mockRunPipeline.mockReset();
    mockRunPipeline.mockResolvedValue({
      success: true,
      jobsDiscovered: 5,
      jobsProcessed: 3,
    });
    mockGetEnabledSchedules.mockResolvedValue([]);
    mockListPipelineSchedules.mockResolvedValue([]);
  });

  afterEach(async () => {
    // Stop all module-level schedulers so they don't leak timers into other
    // tests.
    await refreshPipelineScheduler();
    vi.useRealTimers();
  });

  it("stays disabled when no schedules are enabled", async () => {
    mockGetEnabledSchedules.mockResolvedValue([]);
    mockListPipelineSchedules.mockResolvedValue([]);

    await refreshPipelineScheduler();
    const schedules = await getPipelineSchedules();

    expect(schedules).toEqual([]);
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("arms one scheduler per enabled schedule and runs the pipeline at the set hour", async () => {
    mockGetEnabledSchedules.mockResolvedValue([
      {
        id: "sched-1",
        label: "Morning scan",
        enabled: true,
        hour: 2,
        sources: ["linkedin", "indeed"],
        searchTerms: null,
        country: null,
        cityLocations: null,
        workplaceTypes: null,
        topN: null,
        minSuitabilityScore: null,
        nextRun: null,
      },
    ]);
    mockListPipelineSchedules.mockResolvedValue([
      {
        id: "sched-1",
        label: "Morning scan",
        enabled: true,
        hour: 2,
        sources: ["linkedin", "indeed"],
        searchTerms: null,
        country: null,
        cityLocations: null,
        workplaceTypes: null,
        topN: null,
        minSuitabilityScore: null,
        nextRun: null,
      },
    ]);

    await refreshPipelineScheduler();
    const schedules = await getPipelineSchedules();

    expect(schedules).toHaveLength(1);
    expect(schedules[0].hour).toBe(2);
    expect(schedules[0].sources).toEqual(["linkedin", "indeed"]);
    expect(schedules[0].nextRun).not.toBeNull();

    // Now is 10:00 UTC; hour 2 already passed, so the missed run catches up
    // immediately (dyno-sleep recovery) with the configured sources.
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunPipeline).toHaveBeenCalledWith({
      sources: ["linkedin", "indeed"],
    });

    // The next scheduled run is tomorrow 02:00 UTC.
    const nextRun = new Date(schedules[0].nextRun as string);
    expect(nextRun.getUTCHours()).toBe(2);
    expect(nextRun > new Date("2026-01-15T10:00:00Z")).toBe(true);

    // Advance the clock past the scheduled time (fires the timer once; the
    // scheduler re-arms for the next day but we don't advance further).
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(mockRunPipeline).toHaveBeenCalledTimes(2);
    expect(mockRunPipeline).toHaveBeenLastCalledWith({
      sources: ["linkedin", "indeed"],
    });
  });

  it("passes no sources when none are configured", async () => {
    mockGetEnabledSchedules.mockResolvedValue([
      {
        id: "sched-2",
        label: "Default scan",
        enabled: true,
        hour: 3,
        sources: [],
        searchTerms: null,
        country: null,
        cityLocations: null,
        workplaceTypes: null,
        topN: null,
        minSuitabilityScore: null,
        nextRun: null,
      },
    ]);
    mockListPipelineSchedules.mockResolvedValue([
      {
        id: "sched-2",
        label: "Default scan",
        enabled: true,
        hour: 3,
        sources: [],
        searchTerms: null,
        country: null,
        cityLocations: null,
        workplaceTypes: null,
        topN: null,
        minSuitabilityScore: null,
        nextRun: null,
      },
    ]);

    await refreshPipelineScheduler();

    // Hour 3 already passed: catch-up runs now without any sources.
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunPipeline).toHaveBeenCalledWith({});

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(mockRunPipeline).toHaveBeenCalledTimes(2);
    expect(mockRunPipeline).toHaveBeenLastCalledWith({});
  });

  it("passes advanced config (topN, minSuitabilityScore, country) to runPipeline", async () => {
    mockGetEnabledSchedules.mockResolvedValue([
      {
        id: "sched-3",
        label: "Detailed scan",
        enabled: true,
        hour: 5,
        sources: ["linkedin"],
        searchTerms: ["react developer"],
        country: "united kingdom",
        cityLocations: ["London"],
        workplaceTypes: ["remote"],
        topN: 5,
        minSuitabilityScore: 60,
        nextRun: null,
      },
    ]);
    mockListPipelineSchedules.mockResolvedValue([
      {
        id: "sched-3",
        label: "Detailed scan",
        enabled: true,
        hour: 5,
        sources: ["linkedin"],
        searchTerms: ["react developer"],
        country: "united kingdom",
        cityLocations: ["London"],
        workplaceTypes: ["remote"],
        topN: 5,
        minSuitabilityScore: 60,
        nextRun: null,
      },
    ]);

    await refreshPipelineScheduler();

    // Hour 5 already passed: catch-up runs now with full config.
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunPipeline).toHaveBeenCalledWith({
      sources: ["linkedin"],
      topN: 5,
      minSuitabilityScore: 60,
      searchTerms: ["react developer"],
      country: "united kingdom",
      cityLocations: ["London"],
      workplaceTypes: ["remote"],
    });
  });

  it("manages multiple independent schedules simultaneously", async () => {
    mockGetEnabledSchedules.mockResolvedValue([
      {
        id: "sched-a",
        label: "A",
        enabled: true,
        hour: 1,
        sources: ["linkedin"],
        searchTerms: null,
        country: null,
        cityLocations: null,
        workplaceTypes: null,
        topN: null,
        minSuitabilityScore: null,
        nextRun: null,
      },
      {
        id: "sched-b",
        label: "B",
        enabled: true,
        hour: 2,
        sources: ["indeed"],
        searchTerms: null,
        country: null,
        cityLocations: null,
        workplaceTypes: null,
        topN: null,
        minSuitabilityScore: null,
        nextRun: null,
      },
    ]);
    mockListPipelineSchedules.mockResolvedValue([
      {
        id: "sched-a",
        label: "A",
        enabled: true,
        hour: 1,
        sources: ["linkedin"],
        searchTerms: null,
        country: null,
        cityLocations: null,
        workplaceTypes: null,
        topN: null,
        minSuitabilityScore: null,
        nextRun: null,
      },
      {
        id: "sched-b",
        label: "B",
        enabled: true,
        hour: 2,
        sources: ["indeed"],
        searchTerms: null,
        country: null,
        cityLocations: null,
        workplaceTypes: null,
        topN: null,
        minSuitabilityScore: null,
        nextRun: null,
      },
    ]);

    await refreshPipelineScheduler();

    // Both hours have passed, so both catch up immediately.
    expect(mockRunPipeline).toHaveBeenCalledTimes(2);
    expect(mockRunPipeline).toHaveBeenNthCalledWith(1, {
      sources: ["linkedin"],
    });
    expect(mockRunPipeline).toHaveBeenNthCalledWith(2, {
      sources: ["indeed"],
    });
  });
});
