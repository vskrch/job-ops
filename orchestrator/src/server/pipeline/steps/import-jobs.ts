import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import type { CreateJobInput } from "@shared/types";
import { progressHelpers } from "../progress";

export async function importJobsStep(args: {
  discoveredJobs: CreateJobInput[];
  runId?: string | null;
}): Promise<{ created: number; skipped: number }> {
  logger.info("Importing discovered jobs", { runId: args.runId ?? null });
  const { created, skipped } = await jobsRepo.createJobs(args.discoveredJobs, {
    discoveredByRunId: args.runId ?? null,
  });
  logger.info("Import step complete", { created, skipped });

  progressHelpers.importComplete(created, skipped);

  return { created, skipped };
}
