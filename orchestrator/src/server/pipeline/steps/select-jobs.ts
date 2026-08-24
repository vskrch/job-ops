import type { PipelineConfig } from "@shared/types";
import type { ScoredJob } from "./types";

export function selectJobsStep(args: {
  scoredJobs: ScoredJob[];
  mergedConfig: PipelineConfig;
}): ScoredJob[] {
  const excludeRunIds = args.mergedConfig.excludeRunIds ?? [];
  return args.scoredJobs
    .filter((job) => {
      if ((job.suitabilityScore ?? 0) < args.mergedConfig.minSuitabilityScore) {
        return false;
      }
      if (
        job.discoveredByRunId &&
        excludeRunIds.includes(job.discoveredByRunId)
      ) {
        return false;
      }
      const bd = (
        job as unknown as {
          scoreBreakdown?: {
            locationVerdict?: string;
            languageGate?: string;
            dealBreakerHit?: boolean;
          } | null;
        }
      ).scoreBreakdown;
      if (
        bd &&
        (bd.locationVerdict === "FAIL" ||
          bd.languageGate === "FAIL" ||
          bd.dealBreakerHit)
      ) {
        return false;
      }
      return true;
    })
    .sort(
      (left, right) =>
        (right.suitabilityScore ?? 0) - (left.suitabilityScore ?? 0),
    )
    .slice(0, args.mergedConfig.topN);
}
