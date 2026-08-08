/**
 * Scheduled pipeline runner.
 *
 * Runs the full job discovery/processing pipeline at a configured UTC hour
 * instead of requiring an ad-hoc manual trigger. Config lives in the settings
 * table (pipelineScheduleEnabled / pipelineScheduleHour /
 * pipelineScheduleSources) and is applied on boot and whenever settings
 * change. Uses the shared daily scheduler (same cadence mechanism as backups).
 */

import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { runPipeline } from "@server/pipeline/index";
import * as settingsRepo from "@server/repositories/settings";
import { createScheduler } from "@server/utils/scheduler";
import type { ExtractorSourceId } from "@shared/extractors";
import { isExtractorSourceId } from "@shared/extractors";

interface PipelineScheduleConfig {
  enabled: boolean;
  hour: number;
  sources: ExtractorSourceId[];
}

let currentConfig: PipelineScheduleConfig = {
  enabled: false,
  hour: 2,
  sources: [],
};

const scheduler = createScheduler("pipeline", async () => {
  const config = currentConfig;
  if (!config.enabled) return;

  logger.info("Scheduled pipeline run starting", {
    scheduler: "pipeline",
    hour: config.hour,
    sources: config.sources,
  });

  // Background pipeline run scoped to the default user (single-tenant boot
  // context). Progress events still stream to any subscribed SSE clients.
  await runWithRequestContext({}, async () => {
    const result = await runPipeline({
      ...(config.sources.length > 0 ? { sources: config.sources } : {}),
    });
    logger.info("Scheduled pipeline run finished", {
      scheduler: "pipeline",
      success: result.success,
      jobsDiscovered: result.jobsDiscovered,
      jobsProcessed: result.jobsProcessed,
      error: result.error ?? undefined,
    });
  });
});

async function readSettings(): Promise<PipelineScheduleConfig> {
  const [enabledRaw, hourRaw, sourcesRaw] = await Promise.all([
    settingsRepo.getSetting("pipelineScheduleEnabled"),
    settingsRepo.getSetting("pipelineScheduleHour"),
    settingsRepo.getSetting("pipelineScheduleSources"),
  ]);
  return {
    enabled: enabledRaw === "true" || enabledRaw === "1",
    hour: (() => {
      const parsed = Number.parseInt(hourRaw ?? "", 10);
      return Number.isNaN(parsed) ? 2 : Math.min(23, Math.max(0, parsed));
    })(),
    sources: (() => {
      if (!sourcesRaw) return [];
      try {
        const parsed = JSON.parse(sourcesRaw) as unknown;
        return Array.isArray(parsed)
          ? parsed.filter(
              (s): s is ExtractorSourceId =>
                typeof s === "string" && isExtractorSourceId(s),
            )
          : [];
      } catch {
        return [];
      }
    })(),
  };
}

/**
 * Start (or restart) the scheduler from settings. Called at boot and after
 * settings changes.
 */
export async function refreshPipelineScheduler(): Promise<void> {
  const config = await readSettings();
  currentConfig = config;
  if (!config.enabled) {
    scheduler.stop();
    logger.info("Scheduled pipeline runs disabled", {
      scheduler: "pipeline",
    });
    return;
  }
  scheduler.start(config.hour);
}

/** Read the current effective schedule config (for the status endpoint). */
export function getPipelineSchedule(): {
  enabled: boolean;
  hour: number;
  sources: ExtractorSourceId[];
  nextRun: string | null;
} {
  return {
    enabled: currentConfig.enabled,
    hour: currentConfig.hour,
    sources: currentConfig.sources,
    nextRun: currentConfig.enabled ? scheduler.getNextRun() : null,
  };
}
