import type { CreateJobInput } from "@shared/types/jobs";
import type { AtsProgressEvent, FetchJobOptions } from "./run";

const GREENHOUSE_BOARDS_API = "https://boards-api.greenhouse.io/v1/boards";

interface GreenhouseLocation {
  name?: string;
}

interface GreenhouseDepartment {
  name?: string;
}

interface GreenhouseJobListItem {
  id?: number;
  title?: string;
  absolute_url?: string;
  location?: GreenhouseLocation;
  departments?: GreenhouseDepartment[];
  internal_job_id?: number;
  updated_at?: string;
  first_published?: string;
  company_name?: string;
}

interface GreenhouseJobDetail extends GreenhouseJobListItem {
  content?: string;
  departments?: GreenhouseDepartment[];
}

interface GreenhouseJobsResponse {
  jobs?: GreenhouseJobListItem[];
}

interface GreenhouseJobDetailResponse extends GreenhouseJobDetail {}

function toStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function firstDepartment(
  departments: GreenhouseDepartment[] | undefined,
): string | undefined {
  if (!Array.isArray(departments) || departments.length === 0) return undefined;
  for (const department of departments) {
    const name = toStr(department?.name);
    if (name) return name;
  }
  return undefined;
}

export async function fetchGreenhouseJobs(
  boardToken: string,
  options: FetchJobOptions,
): Promise<CreateJobInput[]> {
  const { fetchImpl, shouldCancel, onProgress } = options;
  const jobs: CreateJobInput[] = [];

  const listUrl = `${GREENHOUSE_BOARDS_API}/${encodeURIComponent(boardToken)}/jobs`;
  onProgress?.({
    type: "source_start",
    source: "greenhouse",
    board: boardToken,
    detail: `Greenhouse: fetching board ${boardToken}`,
  });

  let list: GreenhouseJobListItem[];
  try {
    const response = await fetchImpl(listUrl, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `Greenhouse board ${boardToken} returned ${response.status}`,
      );
    }
    const payload = (await response.json()) as GreenhouseJobsResponse;
    list = Array.isArray(payload.jobs) ? payload.jobs : [];
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onProgress?.({
      type: "source_error",
      source: "greenhouse",
      board: boardToken,
      detail: `Greenhouse: board ${boardToken} failed (${message})`,
    });
    return jobs;
  }

  onProgress?.({
    type: "source_list",
    source: "greenhouse",
    board: boardToken,
    jobsFound: list.length,
    detail: `Greenhouse: board ${boardToken} returned ${list.length} jobs`,
  });

  for (const item of list) {
    if (shouldCancel?.()) break;

    const id = typeof item.id === "number" ? String(item.id) : toStr(item.id);
    const title = toStr(item.title) ?? "Unknown Title";
    const jobUrl = toStr(item.absolute_url);
    if (!jobUrl || !id) continue;

    const employer = toStr(item.company_name) ?? boardToken;
    const location = toStr(item.location?.name);
    const datePosted = toStr(item.first_published) ?? toStr(item.updated_at);

    let jobDescription: string | undefined;
    let department: string | undefined;

    try {
      const detailUrl = `${GREENHOUSE_BOARDS_API}/${encodeURIComponent(boardToken)}/jobs/${id}`;
      const detailResponse = await fetchImpl(detailUrl, {
        headers: { accept: "application/json" },
      });
      if (detailResponse.ok) {
        const detail =
          (await detailResponse.json()) as GreenhouseJobDetailResponse;
        jobDescription = toStr(detail.content);
        department = firstDepartment(detail.departments);
      }
    } catch {
      // Detail fetch is best-effort; continue with list data.
    }

    if (!department) {
      department = firstDepartment(item.departments);
    }

    jobs.push({
      source: "greenhouse",
      sourceJobId: id,
      title,
      employer,
      jobUrl,
      applicationLink: jobUrl,
      location,
      jobDescription,
      jobFunction: department,
      datePosted,
    });
  }

  onProgress?.({
    type: "source_complete",
    source: "greenhouse",
    board: boardToken,
    jobsFound: jobs.length,
    detail: `Greenhouse: board ${boardToken} complete (${jobs.length} jobs)`,
  });

  return jobs;
}

export type { GreenhouseJobListItem, GreenhouseJobDetail };
export type { AtsProgressEvent, FetchJobOptions };
