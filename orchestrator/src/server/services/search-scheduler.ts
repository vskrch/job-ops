/**
 * Scheduled search runner — manages N independent search schedules.
 *
 * Each row in the `search_schedules` table gets its own scheduler instance.
 * Daily schedules use `createScheduler` at a configured UTC hour; hourly
 * schedules use a `setInterval` callback (every 60 minutes with an optional
 * minute offset for staggering). `refreshSearchScheduler()` rebuilds all
 * instances from the DB, and `getSearchSchedules()` returns the list with
 * each schedule's computed `nextRun`.
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import * as jobSearchRepo from "@server/repositories/job-search";
import * as scheduleRepo from "@server/repositories/search-schedules";
import { createScheduler, type Scheduler } from "@server/utils/scheduler";
import type { SearchSchedule } from "@shared/types";

import { executeJobSearch } from "./job-search";
import { sendScheduledSearchNotifications } from "./search-notifications";

interface ActiveScheduler {
  scheduler: Scheduler;
  interval: ReturnType<typeof setInterval> | null;
  frequency: "hourly" | "daily";
  hour: number | null;
}

const activeSchedulers = new Map<string, ActiveScheduler>();

const HOURLY_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Create a job search record for a scheduled run. Unlike the HTTP path,
 * scheduled searches don't need admission-hash dedup since each run creates a
 * fresh search. Uses a derived admission hash from the schedule id + timestamp.
 */
async function createScheduledSearch(
  scheduleId: string,
  query: string,
): Promise<string | null> {
  // Import here to avoid circular dependency at module load time.
  const {
    computeAdmissionHash,
    JOB_SEARCH_PARSER_VERSION,
    SOURCE_PLAN_VERSION,
  } = await import("./job-search");

  const admissionHash = computeAdmissionHash(
    `${scheduleId}:${Date.now()}:${query}`,
    {
      fresh: true,
      sourcePlanVersion: SOURCE_PLAN_VERSION,
    },
  );

  const search = await jobSearchRepo.createJobSearch({
    admissionHash,
    originalQuery: query,
    parserVersion: JOB_SEARCH_PARSER_VERSION,
    sourcePlanVersion: SOURCE_PLAN_VERSION,
  });

  return search?.id ?? null;
}

/**
 * Run a single scheduled search: create a job search, execute it, send
 * notifications, and update the schedule's last-run metadata. Never throws.
 */
async function runScheduledSearch(
  schedule: SearchSchedule & { userId?: string },
  isManual = false,
): Promise<{ searchId: string | null; resultsCount: number | null }> {
  const userId = schedule.userId ?? "default-user";
  const runLog = {
    scheduler: `search-${schedule.id}`,
    scheduleId: schedule.id,
    userId,
    label: schedule.label,
    query: schedule.query,
    manual: isManual,
  };

  logger.info("Scheduled search starting", runLog);

  try {
    const searchId = await runWithRequestContext({ userId }, () =>
      createScheduledSearch(schedule.id, schedule.query),
    );
    if (!searchId) {
      logger.warn(
        "Scheduled search: could not create search record (duplicate?)",
        {
          ...runLog,
        },
      );
      await scheduleRepo.updateScheduleRunResult(
        schedule.id,
        null,
        null,
        new Date().toISOString(),
      );
      return { searchId: null, resultsCount: null };
    }

    // Execute the search to completion within a request context.
    await runWithRequestContext({ searchId, userId }, async () => {
      await executeJobSearch(searchId, schedule.query, userId);
    });

    // Read the completed search for notifications + result count.
    let resultsCount: number | null = null;
    const searchForNotify = await runWithRequestContext(
      { searchId, userId },
      () => jobSearchRepo.getJobSearch(searchId),
    );

    if (searchForNotify && searchForNotify.status === "completed") {
      resultsCount = searchForNotify.results?.totalAfterFilter ?? 0;

      const topJobs = searchForNotify.results?.jobs ?? [];
      const notifyCtx = {
        scheduleId: schedule.id,
        scheduleLabel: schedule.label,
        searchId,
        query: schedule.query,
        resultsCount: searchForNotify.results?.totalAfterFilter ?? 0,
        jobs: topJobs,
      };

      if (schedule.notifyEmail || schedule.notifyWebhook) {
        await runWithRequestContext({ searchId, userId }, () =>
          sendScheduledSearchNotifications(searchForNotify, notifyCtx),
        );
      }
    }

    await scheduleRepo.updateScheduleRunResult(
      schedule.id,
      searchId,
      resultsCount,
      new Date().toISOString(),
    );

    logger.info("Scheduled search completed", {
      ...runLog,
      searchId,
      resultsCount,
      success: searchForNotify?.status === "completed",
    });

    return { searchId, resultsCount };
  } catch (error) {
    logger.error("Scheduled search failed", {
      ...runLog,
      error: error instanceof Error ? error.message : String(error),
    });
    await scheduleRepo.updateScheduleRunResult(
      schedule.id,
      null,
      null,
      new Date().toISOString(),
    );
    return { searchId: null, resultsCount: null };
  }
}

/**
 * Start (or restart) all schedulers from the DB. Called at boot and after any
 * schedule mutation.
 */
/**
 * Stop all active search schedulers and clear intervals.
 * Called during graceful shutdown.
 */
export function stopAllSearchSchedulers(): void {
  for (const entry of activeSchedulers.values()) {
    if (entry.interval) clearInterval(entry.interval);
    entry.scheduler.stop();
  }
  activeSchedulers.clear();
}

export async function refreshSearchScheduler(): Promise<void> {
  // Stop all existing schedulers and intervals.
  stopAllSearchSchedulers();

  const schedules = await scheduleRepo.getEnabledSearchSchedules();

  if (schedules.length === 0) {
    logger.info("No enabled search schedules", {
      scheduler: "search",
    });
    return;
  }

  for (const schedule of schedules) {
    if (schedule.frequency === "hourly") {
      // Hourly: use setInterval for every 60 minutes, with a minute-based
      // offset for staggering. The minute field controls the offset within
      // the hour (0-59 minutes → 0-59 * 60_000 ms initial delay).
      const offsetMs = (schedule.minute % 60) * 60_000;
      let running = false;

      const intervalId = setInterval(async () => {
        if (running) {
          logger.debug(
            "Search schedule already running, skipping hourly tick",
            {
              scheduler: `search-${schedule.id}`,
              scheduleId: schedule.id,
            },
          );
          return;
        }
        running = true;
        try {
          await runScheduledSearch(schedule);
        } finally {
          running = false;
        }
      }, HOURLY_INTERVAL_MS);

      // Stagger the first tick by the offset. We do this by delaying the first
      // setInterval fire using setTimeout for the initial run.
      if (offsetMs > 0) {
        setTimeout(() => {
          void (async () => {
            if (running) return;
            running = true;
            try {
              await runScheduledSearch(schedule);
            } finally {
              running = false;
            }
          })();
        }, offsetMs);
      }

      // Store a no-op scheduler for hourly (so getNextRun works in the list)
      const scheduler = createScheduler(`search-${schedule.id}`, async () => {
        await runScheduledSearch(schedule);
      });

      activeSchedulers.set(schedule.id, {
        scheduler,
        interval: intervalId,
        frequency: "hourly",
        hour: null,
      });
    } else {
      // Daily: use createScheduler at the configured UTC hour.
      const hour = schedule.hour ?? 2;
      const scheduler = createScheduler(`search-${schedule.id}`, async () => {
        logger.info("Scheduled search run starting", {
          scheduler: `search-${schedule.id}`,
          scheduleId: schedule.id,
          label: schedule.label,
          hour,
        });

        await runWithRequestContext({ userId: schedule.userId }, async () => {
          await runScheduledSearch(schedule);
        });
      });

      scheduler.start(hour);
      activeSchedulers.set(schedule.id, {
        scheduler,
        interval: null,
        frequency: "daily",
        hour,
      });
    }
  }

  logger.info("Search schedulers refreshed", {
    scheduler: "search",
    activeCount: activeSchedulers.size,
  });
}

/**
 * Get all search schedules with their computed `nextRun` timestamps.
 */
export async function getSearchSchedules(
  userId?: string,
): Promise<SearchSchedule[]> {
  const schedules = await scheduleRepo.listSearchSchedules(userId);
  return schedules.map((s) => {
    const entry = activeSchedulers.get(s.id);
    let nextRun: string | null = null;

    if (entry && s.enabled) {
      if (entry.frequency === "daily" && entry.hour !== null) {
        nextRun = entry.scheduler.getNextRun();
      } else if (entry.frequency === "hourly") {
        // Estimate next hourly run from now + interval.
        const next = new Date(Date.now() + HOURLY_INTERVAL_MS);
        nextRun = next.toISOString();
      }
    }

    return { ...s, nextRun };
  });
}

/**
 * Manually trigger a search schedule immediately. Returns the search id and
 * results count (or null if the search could not be started).
 */
export async function runSearchScheduleNow(
  scheduleId: string,
  userId?: string,
): Promise<{ searchId: string | null; resultsCount: number | null }> {
  const schedule = await scheduleRepo.getSearchScheduleById(scheduleId, userId);
  if (!schedule) {
    return { searchId: null, resultsCount: null };
  }

  const effectiveUserId =
    (schedule as { userId?: string }).userId ?? userId ?? "default-user";
  return runWithRequestContext({ userId: effectiveUserId }, async () => {
    return runScheduledSearch(schedule, true);
  });
}
