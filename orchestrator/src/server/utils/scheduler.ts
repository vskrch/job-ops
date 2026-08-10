/**
 * Shared daily scheduler utility for running tasks at a specific hour.
 * Used by visa-sponsors, backup, and pipeline services.
 *
 * Resilience: on start(), if the scheduled hour already passed today and the
 * task has not run (or the timer was lost, e.g. after a Heroku dyno sleep),
 * the task runs immediately before scheduling for tomorrow.
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
  /** Run the task immediately (useful for manual triggers or missed runs) */
  runNow(): Promise<void>;
}

interface SchedulerState {
  timer: ReturnType<typeof setTimeout> | null;
  nextRunTime: Date | null;
  currentHour: number | null;
  lastRunDate: string | null;
  running: boolean;
}

/**
 * Calculate the next occurrence of a specific hour (UTC).
 * @param hour - Hour of day (0-23) in UTC
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

/** ISO date key for today (YYYY-MM-DD) in UTC. */
function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Create a reusable daily scheduler.
 *
 * @param name    Service name for logging
 * @param callback Async function to execute at scheduled time
 */
export function createScheduler(
  name: string,
  callback: () => Promise<void>,
): Scheduler {
  const state: SchedulerState = {
    timer: null,
    nextRunTime: null,
    currentHour: null,
    lastRunDate: null,
    running: false,
  };

  function clearTimer(): void {
    if (state.timer) {
      clearTimeout(state.timer);
    }
    state.timer = null;
  }

  async function executeTask(): Promise<void> {
    if (state.running) {
      logger.debug("Scheduler task already running, skipping", {
        scheduler: name,
      });
      return;
    }
    state.running = true;
    logger.info("Scheduler task starting", { scheduler: name });
    const startedAt = Date.now();
    try {
      await callback();
    } catch (error) {
      logger.error("Scheduled task failed", { scheduler: name, error });
    } finally {
      state.running = false;
      state.lastRunDate = todayKey();
    }
    logger.debug("Scheduler task completed", {
      scheduler: name,
      durationMs: Date.now() - startedAt,
    });
  }

  function scheduleNext(hour: number): void {
    clearTimer();

    state.currentHour = hour;
    state.nextRunTime = calculateNextTime(hour);
    const delay = state.nextRunTime.getTime() - Date.now();

    logger.info("Scheduler next run scheduled", {
      scheduler: name,
      nextRun: state.nextRunTime.toISOString(),
    });

    state.timer = setTimeout(async () => {
      await executeTask();
      scheduleNext(hour);
    }, delay);
  }

  return {
    start(hour: number): void {
      if (state.timer) {
        logger.info("Scheduler restarting", { scheduler: name, hour });
        clearTimer();
      } else {
        logger.info("Scheduler starting", { scheduler: name, hour });
      }

      // Resilience: if the scheduled hour already passed today and the task
      // didn't run (dyno sleep, deploy restart, etc.), run immediately.
      const now = new Date();
      const scheduledToday = new Date(now);
      scheduledToday.setUTCHours(hour, 0, 0, 0);
      const alreadyRanToday = state.lastRunDate === todayKey();

      if (scheduledToday <= now && !alreadyRanToday) {
        logger.info(
          "Scheduler missed scheduled time (dyno sleep?), running now",
          { scheduler: name, missedHour: hour },
        );
        executeTask().catch(() => {});
      }

      scheduleNext(hour);
    },

    stop(): void {
      clearTimer();
      state.currentHour = null;
      state.nextRunTime = null;
      logger.info("Scheduler stopped", { scheduler: name });
    },

    getNextRun(): string | null {
      return state.nextRunTime?.toISOString() || null;
    },

    isRunning(): boolean {
      return state.timer !== null;
    },

    async runNow(): Promise<void> {
      logger.info("Scheduler manual trigger", { scheduler: name });
      await executeTask();
    },
  };
}
