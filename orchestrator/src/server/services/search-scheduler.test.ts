import type { SearchSchedule } from "@shared/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@server/repositories/search-schedules", () => ({
  getEnabledSearchSchedules: vi.fn(),
  listSearchSchedules: vi.fn(),
  updateScheduleRunResult: vi.fn(),
  getSearchScheduleById: vi.fn(),
}));

vi.mock("@server/repositories/job-search", () => ({
  createJobSearch: vi.fn().mockResolvedValue({ id: "search-1" }),
  getJobSearch: vi.fn().mockResolvedValue(null),
}));

vi.mock("./job-search", () => ({
  computeAdmissionHash: vi.fn(() => "hash"),
  executeJobSearch: vi.fn().mockResolvedValue(undefined),
  JOB_SEARCH_PARSER_VERSION: "test-parser",
  SOURCE_PLAN_VERSION: "test-plan",
}));

vi.mock("./search-notifications", () => ({
  sendScheduledSearchNotifications: vi.fn(),
}));

import * as jobSearchRepo from "@server/repositories/job-search";
import * as scheduleRepo from "@server/repositories/search-schedules";
import {
  getSearchSchedules,
  refreshSearchScheduler,
  stopAllSearchSchedulers,
} from "./search-scheduler";

const schedule: SearchSchedule & { userId: string } = {
  id: "schedule-1",
  userId: "user-1",
  label: "Hourly search",
  enabled: true,
  frequency: "hourly",
  hour: null,
  minute: 25,
  query: "typescript",
  notifyEmail: false,
  notifyWebhook: false,
  lastRunAt: null,
  lastSearchId: null,
  lastResultsCount: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  nextRun: null,
};

describe("search scheduler", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-15T10:20:30.000Z"));
    vi.mocked(scheduleRepo.getEnabledSearchSchedules).mockReset();
    vi.mocked(scheduleRepo.listSearchSchedules).mockReset();
    vi.mocked(jobSearchRepo.createJobSearch).mockClear();
    vi.mocked(scheduleRepo.getEnabledSearchSchedules).mockResolvedValue([
      schedule,
    ]);
    vi.mocked(scheduleRepo.listSearchSchedules).mockResolvedValue([schedule]);
  });

  afterEach(() => {
    stopAllSearchSchedulers();
    vi.useRealTimers();
  });

  it("runs on the configured UTC minute and reports the real next run", async () => {
    await refreshSearchScheduler();

    await expect(getSearchSchedules("user-1")).resolves.toMatchObject([
      { nextRun: "2026-01-15T10:25:00.000Z" },
    ]);

    await vi.advanceTimersByTimeAsync(4 * 60_000 + 29_000);
    expect(jobSearchRepo.createJobSearch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(jobSearchRepo.createJobSearch).toHaveBeenCalledTimes(1);
    await expect(getSearchSchedules("user-1")).resolves.toMatchObject([
      { nextRun: "2026-01-15T11:25:00.000Z" },
    ]);
  });

  it("does not run a stale timeout after the schedule is disabled", async () => {
    await refreshSearchScheduler();
    vi.mocked(scheduleRepo.getEnabledSearchSchedules).mockResolvedValue([]);
    await refreshSearchScheduler();

    await vi.advanceTimersByTimeAsync(60 * 60_000);

    expect(jobSearchRepo.createJobSearch).not.toHaveBeenCalled();
  });

  it("schedules the next hour when refreshed exactly on the minute", async () => {
    vi.setSystemTime(new Date("2026-01-15T10:25:00.000Z"));

    await refreshSearchScheduler();

    await expect(getSearchSchedules("user-1")).resolves.toMatchObject([
      { nextRun: "2026-01-15T11:25:00.000Z" },
    ]);
    expect(jobSearchRepo.createJobSearch).not.toHaveBeenCalled();
  });
});
