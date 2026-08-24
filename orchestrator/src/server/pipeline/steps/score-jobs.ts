import { logger } from "@infra/logger";
import * as jobsRepo from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import { scoreJobSuitability } from "@server/services/scorer";
import * as visaSponsors from "@server/services/visa-sponsors/index";
import { asyncPool } from "@server/utils/async-pool";
import type { Job } from "@shared/types";
import { progressHelpers, updateProgress } from "../progress";
import type { ScoredJob } from "./types";

const SCORING_CONCURRENCY = 2;

export async function scoreJobsStep(args: {
  profile: Record<string, unknown>;
  excludeRunIds?: string[];
  shouldCancel?: () => boolean;
}): Promise<{ unprocessedJobs: Job[]; scoredJobs: ScoredJob[] }> {
  // Sweep: auto-expire past-deadline discoverable jobs before scoring.
  try {
    await jobsRepo.markPastDeadlineJobsExpired();
  } catch {}
  logger.info("Running scoring step", {
    excludeRunIds: args.excludeRunIds ?? [],
  });
  const unprocessedJobs = await jobsRepo.getUnscoredDiscoveredJobs(
    undefined,
    args.excludeRunIds,
  );

  // Check if auto-skip threshold is configured
  const autoSkipThresholdRaw = await settingsRepo.getSetting(
    "autoSkipScoreThreshold",
  );
  const autoSkipThreshold = autoSkipThresholdRaw
    ? parseInt(autoSkipThresholdRaw, 10)
    : null;

  updateProgress({
    step: "scoring",
    jobsDiscovered: unprocessedJobs.length,
    jobsScored: 0,
    jobsProcessed: 0,
    totalToProcess: 0,
    currentJob: undefined,
  });

  const scoredJobs: ScoredJob[] = [];
  let completed = 0;

  await asyncPool({
    items: unprocessedJobs,
    concurrency: SCORING_CONCURRENCY,
    shouldStop: args.shouldCancel,
    task: async (job) => {
      if (args.shouldCancel?.()) return;

      const hasCachedScore =
        typeof job.suitabilityScore === "number" &&
        !Number.isNaN(job.suitabilityScore);

      if (hasCachedScore) {
        completed += 1;
        progressHelpers.scoringJob(
          completed,
          unprocessedJobs.length,
          `${job.title} (cached)`,
        );
        scoredJobs.push({
          ...job,
          suitabilityScore: job.suitabilityScore as number,
          suitabilityReason: job.suitabilityReason ?? "",
          matchGrade: job.matchGrade ?? "",
          topProject: job.topProject ?? null,
          matchVerdict: job.matchVerdict ?? "",
          scoreBreakdown:
            ((job as unknown as Record<string, unknown>).scoreBreakdown as
              | import("@shared/score-breakdown").ScoreBreakdown
              | null) ?? null,
        });
        return;
      }

      const {
        score,
        reason,
        grade,
        topProject,
        verdict,
        breakdown: rawBreakdown,
      } = await scoreJobSuitability(job, args.profile);
      if (args.shouldCancel?.()) return;

      const breakdown: import("@shared/score-breakdown").ScoreBreakdown =
        (rawBreakdown as import("@shared/score-breakdown").ScoreBreakdown) ?? {
          technical: 50,
          experience: 50,
          behavioral: 50,
          career: 50,
          overall: score,
          locationVerdict: "PASS",
          locationNote: null,
          languageGate: "PASS",
          languageNote: null,
          dealBreakerHit: false,
          dealBreakerNote: null,
          strengths: [],
          gaps: [],
          evaluatedAt: new Date().toISOString(),
        };

      let sponsorMatchScore = 0;
      let sponsorMatchNames: string | undefined;

      if (job.employer) {
        try {
          const sponsorResults = await visaSponsors.searchSponsors(
            job.employer,
            {
              limit: 10,
              minScore: 50,
            },
          );

          const summary =
            visaSponsors.calculateSponsorMatchSummary(sponsorResults);
          sponsorMatchScore = summary.sponsorMatchScore;
          sponsorMatchNames = summary.sponsorMatchNames ?? undefined;
        } catch (error) {
          logger.warn("Sponsor search failed for job, continuing without it", {
            jobId: job.id,
            employer: job.employer,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      // Check if job should be auto-skipped based on score threshold
      const shouldAutoSkip =
        job.status !== "applied" &&
        autoSkipThreshold !== null &&
        !Number.isNaN(autoSkipThreshold) &&
        score < autoSkipThreshold;

      try {
        await jobsRepo.updateJob(job.id, {
          suitabilityScore: score,
          suitabilityReason: reason,
          matchGrade: grade,
          topProject,
          matchVerdict: verdict,
          scoreBreakdown: JSON.stringify(breakdown),
          sponsorMatchScore,
          sponsorMatchNames,
          ...(shouldAutoSkip ? { status: "skipped" } : {}),
        });
      } catch (error) {
        logger.warn("Failed to persist score for job, skipping", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
        completed += 1;
        progressHelpers.scoringJob(
          completed,
          unprocessedJobs.length,
          `${job.title} (persist failed)`,
        );
        return;
      }

      if (shouldAutoSkip) {
        logger.info("Auto-skipped job due to low score", {
          jobId: job.id,
          title: job.title,
          score,
          threshold: autoSkipThreshold,
        });
      }

      completed += 1;
      progressHelpers.scoringJob(completed, unprocessedJobs.length, job.title);
      scoredJobs.push({
        ...job,
        suitabilityScore: score,
        suitabilityReason: reason,
        matchGrade: grade,
        topProject,
        matchVerdict: verdict,
        scoreBreakdown: breakdown,
      });
    },
  });

  progressHelpers.scoringComplete(scoredJobs.length);
  logger.info("Scoring step completed", {
    scoredJobs: scoredJobs.length,
    concurrency: SCORING_CONCURRENCY,
  });

  return { unprocessedJobs, scoredJobs };
}
