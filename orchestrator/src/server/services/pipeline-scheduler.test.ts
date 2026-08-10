import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/settings", () => ({
  getSetting: vi.fn(),
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
import { getSetting } from "@server/repositories/settings";
import {
  getPipelineSchedule,
  refreshPipelineScheduler,
} from "./pipeline-scheduler";

const mockGetSetting = vi.mocked(getSetting);
const mockRunPipeline = vi.mocked(runPipeline);

describe("pipeline-scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:00:00Z"));
    mockGetSetting.mockReset();
    mockRunPipeline.mockReset();
    // mockReset() wipes the factory default; restore a resolved result so
    // scheduler callback logging never sees an undefined pipeline result.
    mockRunPipeline.mockResolvedValue({
      success: true,
      jobsDiscovered: 5,
      jobsProcessed: 3,
    });
    mockGetSetting.mockImplementation(async (key) => {
      if (key === "pipelineScheduleEnabled") return "0";
      return null;
    });
  });

  afterEach(async () => {
    // Stop the module-level scheduler so it doesn't leak timers into other
    // tests.
    await refreshPipelineScheduler();
    vi.useRealTimers();
  });

  it("stays disabled when the schedule setting is off", async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === "pipelineScheduleEnabled") return "0";
      if (key === "pipelineScheduleHour") return "2";
      return null;
    });

    await refreshPipelineScheduler();
    const schedule = getPipelineSchedule();

    expect(schedule.enabled).toBe(false);
    expect(schedule.nextRun).toBeNull();
    expect(mockRunPipeline).not.toHaveBeenCalled();
  });

  it("arms the scheduler when enabled and runs the pipeline at the set hour", async () => {
    mockGetSetting.mockImplementation(async (key) => {
      if (key === "pipelineScheduleEnabled") return "1";
      if (key === "pipelineScheduleHour") return "2";
      if (key === "pipelineScheduleSources")
        return JSON.stringify(["linkedin", "indeed"]);
      return null;
    });

    await refreshPipelineScheduler();
    const schedule = getPipelineSchedule();

    expect(schedule.enabled).toBe(true);
    expect(schedule.hour).toBe(2);
    expect(schedule.sources).toEqual(["linkedin", "indeed"]);
    expect(schedule.nextRun).not.toBeNull();

    // Now is 10:00 UTC; hour 2 already passed, so the missed run catches up
    // immediately (dyno-sleep recovery) with the configured sources.
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunPipeline).toHaveBeenCalledWith({
      sources: ["linkedin", "indeed"],
    });

    // The next scheduled run is tomorrow 02:00 UTC.
    const nextRun = new Date(schedule.nextRun as string);
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
    mockGetSetting.mockImplementation(async (key) => {
      if (key === "pipelineScheduleEnabled") return "1";
      if (key === "pipelineScheduleHour") return "3";
      return null;
    });

    await refreshPipelineScheduler();

    // Hour 3 already passed: catch-up runs now without any sources.
    expect(mockRunPipeline).toHaveBeenCalledTimes(1);
    expect(mockRunPipeline).toHaveBeenCalledWith({});

    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(mockRunPipeline).toHaveBeenCalledTimes(2);
    expect(mockRunPipeline).toHaveBeenLastCalledWith({});
  });
});
