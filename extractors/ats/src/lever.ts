import type { CreateJobInput } from "@shared/types/jobs";
import type { AtsProgressEvent, FetchJobOptions } from "./run";

const LEVER_API_BASE = "https://api.lever.co/v0/postings";
const LEVER_EU_API_BASE = "https://api.eu.lever.co/v0/postings";
const LEVER_PAGE_SIZE = 100;

interface LeverCategories {
  team?: string;
  commitment?: string;
  location?: string;
  department?: string;
  allLocations?: string[];
}

interface LeverPosting {
  id?: string;
  text?: string;
  categories?: LeverCategories;
  description?: string;
  descriptionPlain?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  country?: string;
}

function toStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function inferJobType(commitment: string | undefined): string | undefined {
  if (!commitment) return undefined;
  const normalized = commitment.toLowerCase();
  if (/full/.test(normalized)) return "Full-time";
  if (/part/.test(normalized)) return "Part-time";
  if (/contract/.test(normalized)) return "Contract";
  if (/intern/.test(normalized)) return "Internship";
  if (/temp/.test(normalized)) return "Temporary";
  return commitment;
}

function mapLeverPosting(
  posting: LeverPosting,
  company: string,
): CreateJobInput | null {
  const id = toStr(posting.id);
  const title = toStr(posting.text) ?? "Unknown Title";
  const jobUrl = toStr(posting.hostedUrl);
  if (!id || !jobUrl) return null;

  const categories = posting.categories ?? {};
  const location = toStr(categories.location);
  const description =
    toStr(posting.descriptionPlain) ?? toStr(posting.description);
  const datePosted =
    typeof posting.createdAt === "number"
      ? new Date(posting.createdAt).toISOString()
      : undefined;

  return {
    source: "lever",
    sourceJobId: id,
    title,
    employer: company,
    jobUrl,
    applicationLink: toStr(posting.applyUrl) ?? jobUrl,
    location,
    jobDescription: description,
    jobType: inferJobType(toStr(categories.commitment)),
    jobFunction: toStr(categories.team) ?? toStr(categories.department),
    datePosted,
    isRemote: /remote/i.test(toStr(posting.workplaceType) ?? ""),
  };
}

async function fetchLeverShard(
  apiBase: string,
  company: string,
  fetchImpl: typeof fetch,
): Promise<LeverPosting[]> {
  const all: LeverPosting[] = [];
  let skip = 0;

  while (true) {
    const url = new URL(`${apiBase}/${encodeURIComponent(company)}`);
    url.searchParams.set("mode", "json");
    url.searchParams.set("skip", String(skip));
    url.searchParams.set("limit", String(LEVER_PAGE_SIZE));

    const response = await fetchImpl(url, {
      headers: { accept: "application/json" },
    });
    if (!response.ok) {
      throw new Error(
        `Lever ${company} returned ${response.status} on ${apiBase}`,
      );
    }

    const payload = (await response.json()) as unknown;
    if (!Array.isArray(payload)) break;
    const page = payload as LeverPosting[];
    if (page.length === 0) break;

    all.push(...page);
    if (page.length < LEVER_PAGE_SIZE) break;
    skip += LEVER_PAGE_SIZE;
  }

  return all;
}

export async function fetchLeverJobs(
  company: string,
  options: FetchJobOptions,
): Promise<CreateJobInput[]> {
  const { fetchImpl, shouldCancel, onProgress } = options;
  const jobs: CreateJobInput[] = [];

  onProgress?.({
    type: "source_start",
    source: "lever",
    board: company,
    detail: `Lever: fetching company ${company}`,
  });

  let postings: LeverPosting[];
  try {
    try {
      postings = await fetchLeverShard(LEVER_API_BASE, company, fetchImpl);
    } catch (error) {
      if (error instanceof Error && /404/.test(error.message)) {
        postings = await fetchLeverShard(LEVER_EU_API_BASE, company, fetchImpl);
      } else {
        throw error;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    onProgress?.({
      type: "source_error",
      source: "lever",
      board: company,
      detail: `Lever: company ${company} failed (${message})`,
    });
    return jobs;
  }

  onProgress?.({
    type: "source_list",
    source: "lever",
    board: company,
    jobsFound: postings.length,
    detail: `Lever: company ${company} returned ${postings.length} jobs`,
  });

  for (const posting of postings) {
    if (shouldCancel?.()) break;
    const mapped = mapLeverPosting(posting, company);
    if (!mapped) continue;
    jobs.push(mapped);
  }

  onProgress?.({
    type: "source_complete",
    source: "lever",
    board: company,
    jobsFound: jobs.length,
    detail: `Lever: company ${company} complete (${jobs.length} jobs)`,
  });

  return jobs;
}

export type { LeverPosting, LeverCategories };
export type { AtsProgressEvent, FetchJobOptions };
