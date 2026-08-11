/**
 * Scheduled pipeline runner — manages N independent daily schedules.
 *
 * Each schedule row in the `pipeline_schedules` table gets its own
 * `createScheduler` instance. Enabled schedules fire `runPipeline` at their
 * configured UTC hour with that schedule's config (sources, searchTerms,
 * country, etc.). `refreshPipelineScheduler()` rebuilds all scheduler
 * instances from the DB, and `getPipelineSchedules()` returns the list with
 * each schedule's computed `nextRun`.
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { runPipeline } from "@server/pipeline/index";
import * as scheduleRepo from "@server/repositories/pipeline-schedules";
import { createScheduler, type Scheduler } from "@server/utils/scheduler";
import type { PipelineSchedule } from "@shared/types";

// Map of schedule id → scheduler instance + the schedule's hour (so we can
// compute nextRun). Only enabled schedules have entries.
const activeSchedulers = new Map<
  string,
  { scheduler: Scheduler; hour: number }
>();

/**
 * Build a runPipeline config object from a schedule's advanced config fields.
 */
function buildRunConfig(schedule: {
  sources: string[];
  searchTerms?: string[] | null;
  country?: string | null;
  cityLocations?: string[] | null;
  workplaceTypes?: string[] | null;
  topN?: number | null;
  minSuitabilityScore?: number | null;
}): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (schedule.sources.length > 0) {
    config.sources = schedule.sources;
  }
  if (schedule.topN != null) {
    config.topN = schedule.topN;
  }
  if (schedule.minSuitabilityScore != null) {
    config.minSuitabilityScore = schedule.minSuitabilityScore;
  }
  if (schedule.searchTerms && schedule.searchTerms.length > 0) {
    config.searchTerms = schedule.searchTerms;
  }
  if (schedule.country) {
    config.country = schedule.country;
  }
  if (schedule.cityLocations && schedule.cityLocations.length > 0) {
    config.cityLocations = schedule.cityLocations;
  }
  if (schedule.workplaceTypes && schedule.workplaceTypes.length > 0) {
    config.workplaceTypes = schedule.workplaceTypes;
  }
  return config;
}

/**
 * Start (or restart) all schedulers from the DB. Called at boot and after any
 * schedule mutation.
 */
export async function refreshPipelineScheduler(): Promise<void> {
  // Stop all existing schedulers.
  for (const { scheduler } of activeSchedulers.values()) {
    scheduler.stop();
  }
  activeSchedulers.clear();

  const schedules = await scheduleRepo.getEnabledSchedules();

  if (schedules.length === 0) {
    logger.info("No enabled pipeline schedules", {
      scheduler: "pipeline",
    });
    return;
  }

  for (const schedule of schedules) {
    const scheduler = createScheduler(`pipeline-${schedule.id}`, async () => {
      logger.info("Scheduled pipeline run starting", {
        scheduler: `pipeline-${schedule.id}`,
        scheduleId: schedule.id,
        label: schedule.label,
        hour: schedule.hour,
        sources: schedule.sources,
      });

      await runWithRequestContext({}, async () => {
        const runConfig = buildRunConfig(schedule);
        const result = await runPipeline(runConfig);
        logger.info("Scheduled pipeline run finished", {
          scheduler: `pipeline-${schedule.id}`,
          scheduleId: schedule.id,
          success: result.success,
          jobsDiscovered: result.jobsDiscovered,
          jobsProcessed: result.jobsProcessed,
          error: result.error ?? undefined,
        });
      });
    });

    scheduler.start(schedule.hour);
    activeSchedulers.set(schedule.id, { scheduler, hour: schedule.hour });
  }

  logger.info("Pipeline schedulers refreshed", {
    scheduler: "pipeline",
    activeCount: activeSchedulers.size,
  });
}

/**
 * Get all schedules with their computed `nextRun` timestamps (for the status
 * endpoint and the UI).
 */
export async function getPipelineSchedules(): Promise<PipelineSchedule[]> {
  const schedules = await scheduleRepo.listPipelineSchedules();
  return schedules.map((s) => {
    const entry = activeSchedulers.get(s.id);
    return {
      ...s,
      nextRun: entry ? entry.scheduler.getNextRun() : null,
    };
  });
}

// Re-export for backwards compat. Some callers may import getPipelineSchedule
// (singular). This now returns the "primary" schedule or null.
export { getPipelineSchedules as getPipelineScheduleList };
