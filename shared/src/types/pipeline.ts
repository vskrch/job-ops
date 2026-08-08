import type { ExtractorSourceId } from "../extractors";
import type { Job, JobStatus } from "./jobs";

export interface PipelineConfig {
  topN: number; // Number of top jobs to process
  minSuitabilityScore: number; // Minimum score to auto-process
  sources: ExtractorSourceId[]; // Job sources to crawl
  outputDir: string; // Directory for generated PDFs
  enableCrawling?: boolean;
  enableScoring?: boolean;
  enableImporting?: boolean;
  enableAutoTailoring?: boolean;
  hoursOld?: number | null;
  /**
   * IDs of previous pipeline runs whose jobs should be excluded from
   * scoring/processing in this run (used to avoid re-surfacing jobs the
   * user already saw and filtered out).
   */
  excludeRunIds?: string[];
}

/** Snapshot of the effective run configuration persisted with the run. */
export interface PipelineRunConfigSnapshot {
  topN: number;
  minSuitabilityScore: number;
  sources: ExtractorSourceId[];
  searchTerms: string[];
  country: string | null;
  cityLocations: string[];
  workplaceTypes: string[];
  hoursOld: number | null;
  excludeRunIds: string[];
}

export interface PipelineRun {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  jobsDiscovered: number;
  jobsProcessed: number;
  errorMessage: string | null;
  config: PipelineRunConfigSnapshot | null;
}

/** Short human-friendly run id derived from the stored id (first 8 chars). */
export function pipelineRunShortId(id: string): string {
  return id.slice(0, 8);
}

export interface PipelineStatusResponse {
  isRunning: boolean;
  lastRun: PipelineRun | null;
  nextScheduledRun: string | null;
}

export interface PipelineScheduleResponse {
  enabled: boolean;
  hour: number;
  sources: ExtractorSourceId[];
  nextRun: string | null;
}

export interface UpdatePipelineScheduleInput {
  enabled?: boolean;
  hour?: number;
  sources?: ExtractorSourceId[];
}

export interface JobsListResponse<TJob = Job> {
  jobs: TJob[];
  total: number;
  byStatus: Record<JobStatus, number>;
  revision: string;
}

export interface JobsRevisionResponse {
  revision: string;
  latestUpdatedAt: string | null;
  total: number;
  statusFilter: string | null;
}

export type JobAction = "skip" | "move_to_ready" | "rescore";

export type JobActionRequest =
  | {
      action: "skip" | "rescore";
      jobIds: string[];
    }
  | {
      action: "move_to_ready";
      jobIds: string[];
      options?: {
        force?: boolean;
      };
    };

export type JobActionResult =
  | {
      jobId: string;
      ok: true;
      job: Job;
    }
  | {
      jobId: string;
      ok: false;
      error: {
        code: string;
        message: string;
      };
    };

export interface JobActionResponse {
  action: JobAction;
  requested: number;
  succeeded: number;
  failed: number;
  results: JobActionResult[];
}

export type JobActionStreamEvent =
  | {
      type: "started";
      action: JobAction;
      requested: number;
      completed: number;
      succeeded: number;
      failed: number;
      requestId: string;
    }
  | {
      type: "progress";
      action: JobAction;
      requested: number;
      completed: number;
      succeeded: number;
      failed: number;
      result: JobActionResult;
      requestId: string;
    }
  | {
      type: "completed";
      action: JobAction;
      requested: number;
      completed: number;
      succeeded: number;
      failed: number;
      results: JobActionResult[];
      requestId: string;
    }
  | {
      type: "error";
      code: string;
      message: string;
      requestId: string;
    };

export interface BackupInfo {
  filename: string;
  type: "auto" | "manual";
  size: number;
  createdAt: string;
}
