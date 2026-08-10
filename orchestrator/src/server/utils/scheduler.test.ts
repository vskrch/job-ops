import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { calculateNextTime, createScheduler } from "./scheduler";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("calculateNextTime", () => {
  it("should return today if hour is in the future", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const result = calculateNextTime(14); // 2 PM

    expect(result.getUTCHours()).toBe(14);
    expect(result.getUTCDate()).toBe(15); // Same day
    expect(result.getTime()).toBeGreaterThan(now.getTime());
  });

  it("should return tomorrow if hour has passed today", () => {
    const now = new Date("2026-01-15T16:00:00Z");
    vi.setSystemTime(now);

    const result = calculateNextTime(10); // 10 AM (already passed)

    expect(result.getUTCHours()).toBe(10);
    expect(result.getUTCDate()).toBe(16); // Next day
  });

  it("should return tomorrow if current time equals target hour", () => {
    const now = new Date("2026-01-15T14:00:00Z");
    vi.setSystemTime(now);

    const result = calculateNextTime(14); // Same hour

    expect(result.getUTCHours()).toBe(14);
    expect(result.getUTCDate()).toBe(16); // Next day (since we're at exactly 14:00)
  });

  it("should handle hour 0 (midnight)", () => {
    const now = new Date("2026-01-15T12:00:00Z");
    vi.setSystemTime(now);

    const result = calculateNextTime(0); // Midnight

    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCDate()).toBe(16); // Next day
  });

  it("should handle hour 23", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const result = calculateNextTime(23);

    expect(result.getUTCHours()).toBe(23);
    expect(result.getUTCDate()).toBe(15); // Same day
  });
});

describe("createScheduler", () => {
  it("should create a scheduler with initial stopped state", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler("test", callback);

    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.getNextRun()).toBeNull();
  });

  it("should start scheduling when start() is called", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const callback = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler("test", callback);

    scheduler.start(14);

    expect(scheduler.isRunning()).toBe(true);
    expect(scheduler.getNextRun()).not.toBeNull();
  });

  it("should stop scheduling when stop() is called", () => {
    const callback = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler("test", callback);

    scheduler.start(14);
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    expect(scheduler.isRunning()).toBe(false);
    expect(scheduler.getNextRun()).toBeNull();
  });

  it("should execute callback after delay (simulated)", async () => {
    const now = new Date("2026-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const callback = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler("test", callback);

    // Start at hour 14 (still in the future today, so no missed-run catch-up
    // fires; the timer drives the only invocation).
    scheduler.start(14);

    // Fast-forward time by 24 hours to trigger the callback
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(callback).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it("should reschedule after execution", async () => {
    const now = new Date("2026-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const callback = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler("test", callback);

    scheduler.start(10);
    const firstRun = scheduler.getNextRun();

    // Fast-forward 24 hours to trigger execution and rescheduling
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    const secondRun = scheduler.getNextRun();

    // Second run should be 24 hours after first run
    expect(secondRun).not.toBe(firstRun);
    expect(secondRun).not.toBeNull();
    expect(firstRun).not.toBeNull();
    if (secondRun && firstRun) {
      expect(new Date(secondRun).getTime()).toBe(
        new Date(firstRun).getTime() + 24 * 60 * 60 * 1000,
      );
    }

    scheduler.stop();
  });

  it("should restart with new hour when start() called again", () => {
    const now = new Date("2026-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const callback = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler("test", callback);

    scheduler.start(14); // 2 PM
    const firstRun = scheduler.getNextRun();

    scheduler.start(16); // 4 PM
    const secondRun = scheduler.getNextRun();

    // Second run should be later than first run
    expect(secondRun).not.toBeNull();
    expect(firstRun).not.toBeNull();
    if (secondRun && firstRun) {
      expect(new Date(secondRun).getTime()).toBeGreaterThan(
        new Date(firstRun).getTime(),
      );
    }

    scheduler.stop();
  });

  it("runs immediately when the scheduled hour already passed (missed-run recovery)", async () => {
    const now = new Date("2026-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const callback = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler("test", callback);

    // Hour 8 already passed today: the task must catch up immediately,
    // then schedule for tomorrow at the same hour.
    scheduler.start(8);

    await vi.advanceTimersByTimeAsync(0);

    expect(callback).toHaveBeenCalledTimes(1);

    const nextRun = scheduler.getNextRun();
    expect(nextRun).not.toBeNull();
    if (nextRun) {
      const date = new Date(nextRun);
      expect(date.getUTCHours()).toBe(8);
      expect(date.getUTCDate()).toBe(16); // Tomorrow
    }

    scheduler.stop();
  });

  it("does not re-run the missed task when restarted the same day", async () => {
    const now = new Date("2026-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const callback = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler("test", callback);

    scheduler.start(8); // catch-up run
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);

    scheduler.stop();
    scheduler.start(8); // restart same day: already ran, no catch-up
    await vi.advanceTimersByTimeAsync(0);
    expect(callback).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it("should execute the callback immediately via runNow()", async () => {
    const now = new Date("2026-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const callback = vi.fn().mockResolvedValue(undefined);
    const scheduler = createScheduler("test", callback);

    scheduler.start(14);
    expect(callback).not.toHaveBeenCalled();

    await scheduler.runNow();
    expect(callback).toHaveBeenCalledTimes(1);

    scheduler.stop();
  });

  it("should handle callback errors gracefully", async () => {
    const now = new Date("2026-01-15T10:00:00Z");
    vi.setSystemTime(now);

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const callback = vi.fn().mockRejectedValue(new Error("Test error"));
    const scheduler = createScheduler("test", callback);

    // Hour 14 is still in the future today, so only the timer fires.
    scheduler.start(14);

    // Fast-forward 24 hours to trigger execution
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);

    expect(callback).toHaveBeenCalled();
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const loggedLine = consoleSpy.mock.calls[0][0] as string;
    expect(loggedLine).toContain('"level":"error"');
    expect(loggedLine).toContain("Scheduled task failed");
    expect(loggedLine).toContain('"scheduler":"test"');

    // Scheduler should still be running after error
    expect(scheduler.isRunning()).toBe(true);

    scheduler.stop();
    consoleSpy.mockRestore();
  });
});
