import type { CreateJobInput } from "@shared/types/jobs";
import type { AtsProgressEvent, FetchJobOptions } from "./run";

const ASHBY_API_BASE = "https://api.ashbyhq.com/posting-api/job-board";

interface AshbyJob {
  id?: string;
  title?: string;
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  isRemote?: boolean;
  workplaceType?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  publishedAt?: string;
}

interface AshbyJobsResponse {
  jobs?: AshbyJob[];
}

function toStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function inferJobType(employmentType: string | undefined): string | undefined {
  if (!employmentType) return undefined;
  const normalized = employmentType.toLowerCase();
  if (/full/.test(normalized)) return "Full-time";
  if (/part/.test(normalized)) return "Part-time";
  if (/contract/.test(normalized)) return "Contract";
  if (/intern/.test(normalized)) return "Internship";
  if (/temp/.test(normalized)) return "Temporary";
  return employmentType;
}

function mapAshbyJob(job: AshbyJob, org: string): CreateJobInput | null {
  const id = toStr(job.id);
  const title = toStr(job.title) ?? "Unknown Title";
  const jobUrl = toStr(job.jobUrl);
  if (!id || !jobUrl) return null;

  const description = toStr(job.descriptionPlain) ?? toStr(job.descriptionHtml);
  const datePosted = toStr(job.publishedAt);

  return {
    source: "ashby",
    sourceJobId: id,
    title,
    employer: org,
    jobUrl,
    applicationLink: toStr(job.applyUrl) ?? jobUrl,
    location: toStr(job.location),
    jobDescription: description,
    jobType: inferJobType(toStr(job.employmentType)),
    jobFunction: toStr(job.department) ?? toStr(job.team),
    isRemote: Boolean(job.isRemote),
    datePosted,
  };
}

export async function fetchAshbyJobs(
  org: string,
  options: FetchJobOptions,
): Promise<CreateJobInput[]> {
  const { fetchImpl, shouldCancel, onProgress } = options;
  const jobs: CreateJobInput[] = [];

  onProgress?.({
    type: "source_start",
    source: "ashby",
    board: org,
    detail: `Ashby: fetching org ${org}`,
  });

  const url = new URL(`${ASHBY_API_BASE}/${encodeURIComponent(org)}`);
  url.searchParams.set("includeCompensation", "true");

  let ashbyJobs: AshbyJob[];
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(`Ashby org ${org} returned ${response.status}`);
    }
    const payload = (await response.json()) as AshbyJobsResponse;
    ashbyJobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onProgress?.({
      type: "source_error",
      source: "ashby",
      board: org,
      detail: `Ashby: org ${org} failed (${message})`,
    });
    return jobs;
  }

  onProgress?.({
    type: "source_list",
    source: "ashby",
    board: org,
    jobsFound: ashbyJobs.length,
    detail: `Ashby: org ${org} returned ${ashbyJobs.length} jobs`,
  });

  for (const job of ashbyJobs) {
    if (shouldCancel?.()) break;
    const mapped = mapAshbyJob(job, org);
    if (!mapped) continue;
    jobs.push(mapped);
  }

  onProgress?.({
    type: "source_complete",
    source: "ashby",
    board: org,
    jobsFound: jobs.length,
    detail: `Ashby: org ${org} complete (${jobs.length} jobs)`,
  });

  return jobs;
}

export type { AshbyJob };
export type { AtsProgressEvent, FetchJobOptions };
