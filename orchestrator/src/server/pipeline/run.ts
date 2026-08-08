/**
 * Standalone script to run the pipeline.
 * Can be triggered by n8n or cron.
 *
 * Usage: npm run pipeline:run
 */

import { logger } from "@infra/logger";
import "../config/env";
import { closeDb } from "../db/index";
import { runPipeline } from "./orchestrator";

async function main() {
  logger.info("Pipeline runner started");

  const result = await runPipeline({
    topN: parseInt(process.env.PIPELINE_TOP_N || "10", 10),
    minSuitabilityScore: parseInt(process.env.PIPELINE_MIN_SCORE || "50", 10),
  });

  logger.info("Pipeline runner finished", {
    success: result.success,
    jobsDiscovered: result.jobsDiscovered,
    jobsProcessed: result.jobsProcessed,
    error: result.error ?? undefined,
  });

  closeDb();
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  logger.error("Pipeline runner fatal error", { error });
  closeDb();
  process.exit(1);
});
