import type { CreateJobInput } from "@shared/types/jobs";
import { fetchAshbyJobs } from "./ashby";
import { fetchGreenhouseJobs } from "./greenhouse";
import { fetchLeverJobs } from "./lever";

export type AtsSourceType = "greenhouse" | "lever" | "ashby";

export type AtsProgressEvent =
  | {
      type: "source_start";
      source: AtsSourceType;
      board: string;
      detail: string;
    }
  | {
      type: "source_list";
      source: AtsSourceType;
      board: string;
      jobsFound: number;
      detail: string;
    }
  | {
      type: "source_complete";
      source: AtsSourceType;
      board: string;
      jobsFound: number;
      detail: string;
    }
  | {
      type: "source_error";
      source: AtsSourceType;
      board: string;
      detail: string;
    }
  | {
      type: "run_complete";
      totalJobs: number;
      detail: string;
    };

export interface FetchJobOptions {
  fetchImpl: typeof fetch;
  shouldCancel?: () => boolean;
  onProgress?: (event: AtsProgressEvent) => void;
}

export interface RunAtsOptions {
  greenhouseBoards?: string[];
  leverCompanies?: string[];
  ashbyOrgs?: string[];
  fetchImpl?: typeof fetch;
  shouldCancel?: () => boolean;
  onProgress?: (event: AtsProgressEvent) => void;
}

export interface AtsResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function runAts(options: RunAtsOptions = {}): Promise<AtsResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const greenhouseBoards = options.greenhouseBoards ?? [];
  const leverCompanies = options.leverCompanies ?? [];
  const ashbyOrgs = options.ashbyOrgs ?? [];

  const fetchOptions: FetchJobOptions = {
    fetchImpl,
    shouldCancel: options.shouldCancel,
    onProgress: options.onProgress,
  };

  try {
    const jobs: CreateJobInput[] = [];
    const seen = new Set<string>();

    for (const board of greenhouseBoards) {
      if (options.shouldCancel?.()) break;
      const boardJobs = await fetchGreenhouseJobs(board, fetchOptions);
      for (const job of boardJobs) {
        const key = job.sourceJobId ?? job.jobUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push(job);
      }
    }

    for (const company of leverCompanies) {
      if (options.shouldCancel?.()) break;
      const companyJobs = await fetchLeverJobs(company, fetchOptions);
      for (const job of companyJobs) {
        const key = job.sourceJobId ?? job.jobUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push(job);
      }
    }

    for (const org of ashbyOrgs) {
      if (options.shouldCancel?.()) break;
      const orgJobs = await fetchAshbyJobs(org, fetchOptions);
      for (const job of orgJobs) {
        const key = job.sourceJobId ?? job.jobUrl;
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push(job);
      }
    }

    options.onProgress?.({
      type: "run_complete",
      totalJobs: jobs.length,
      detail: `ATS: run complete (${jobs.length} jobs)`,
    });

    return { success: true, jobs };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : typeof error === "string"
          ? error
          : "Unexpected error while running ATS extractor.";
    return { success: false, jobs: [], error: message };
  }
}

export { parseList };
