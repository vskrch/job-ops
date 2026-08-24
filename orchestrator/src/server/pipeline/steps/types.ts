import type { ScoreBreakdown } from "@shared/score-breakdown";
import type { CreateJobInput, Job, PipelineConfig } from "@shared/types";

export type ScoredJob = Job & {
  suitabilityScore: number;
  suitabilityReason: string;
  matchGrade: string;
  topProject: string | null;
  matchVerdict: string;
  scoreBreakdown: ScoreBreakdown | null;
};

export type RunPipelineContext = {
  mergedConfig: PipelineConfig;
  profile: Record<string, unknown>;
  discoveredJobs: CreateJobInput[];
  sourceErrors: string[];
  created: number;
  skipped: number;
  unprocessedJobs: Job[];
  scoredJobs: ScoredJob[];
  jobsToProcess: ScoredJob[];
  processedCount: number;
};
