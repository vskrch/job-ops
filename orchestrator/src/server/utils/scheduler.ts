/**
 * Shared daily scheduler utility for running tasks at a specific hour.
 * Used by visa-sponsors and backup services.
 */

import { logger } from "@infra/logger";

export interface Scheduler {
  /** Start scheduling at the specified hour (0-23) */
  start(hour: number): void;
  /** Stop the scheduler */
  stop(): void;
  /** Get ISO string of next scheduled run, or null if not running */
  getNextRun(): string | null;
  /** Check if scheduler is currently running */
  isRunning(): boolean;
}

interface SchedulerState {
  timer: ReturnType<typeof setTimeout> | null;
  nextRunTime: Date | null;
  currentHour: number | null;
}

/**
 * Calculate the next occurrence of a specific hour (UTC)
 * @param hour - Hour of day (0-23) in UTC
 * @returns Date object set to the next UTC occurrence of that hour
 */
export function calculateNextTime(hour: number): Date {
  const now = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);

  // If we've passed the time today, schedule for tomorrow
  if (next <= now) {
    next.setUTCDate(next.getUTCDate() + 1);
  }

  return next;
}

/**
 * Create a reusable daily scheduler
 * @param name - Service name for logging
 * @param callback - Async function to execute at scheduled time
 * @returns Scheduler interface with start/stop/getNextRun methods
 */
export function createScheduler(
  name: string,
  callback: () => Promise<void>,
): Scheduler {
  const state: SchedulerState = {
    timer: null,
    nextRunTime: null,
    currentHour: null,
  };

  function clearState(): void {
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = null;
    state.nextRunTime = null;
    state.currentHour = null;
  }

  function scheduleNext(hour: number): void {
    // Clear any existing timer
    if (state.timer) {
      clearState();
    }

    state.currentHour = hour;
    state.nextRunTime = calculateNextTime(hour);
    const delay = state.nextRunTime.getTime() - Date.now();

    logger.info("Scheduler next run scheduled", {
      scheduler: name,
      nextRun: state.nextRunTime.toISOString(),
    });

    state.timer = setTimeout(async () => {
      logger.info("Scheduler task starting", { scheduler: name });
      const startedAt = Date.now();
      try {
        await callback();
      } catch (error) {
        logger.error("Scheduled task failed", { scheduler: name, error });
      }
      logger.debug("Scheduler task completed", {
        scheduler: name,
        durationMs: Date.now() - startedAt,
      });
      // Reschedule for next occurrence
      scheduleNext(hour);
    }, delay);
  }

  return {
    start(hour: number): void {
      if (state.timer) {
        logger.info("Scheduler restarting", { scheduler: name, hour });
        clearState();
      } else {
        logger.info("Scheduler starting", { scheduler: name, hour });
      }
      scheduleNext(hour);
    },

    stop(): void {
      if (state.timer) {
        clearState();
        logger.info("Scheduler stopped", { scheduler: name });
      }
    },

    getNextRun(): string | null {
      return state.nextRunTime?.toISOString() || null;
    },

    isRunning(): boolean {
      return state.timer !== null;
    },
  };
}
