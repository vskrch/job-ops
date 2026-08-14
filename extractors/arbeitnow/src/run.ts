import { normalizeCountryKey } from "@shared/location-support.js";
import type { CreateJobInput } from "@shared/types/jobs";

const ARBEITNOW_API_URL = "https://www.arbeitnow.com/api/job-board-api";

export interface ArbeitnowProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunArbeitnowOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  onProgress?: (event: ArbeitnowProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface ArbeitnowResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface ArbeitnowJob {
  slug?: unknown;
  company_name?: unknown;
  title?: unknown;
  description?: unknown;
  remote?: unknown;
  url?: unknown;
  tags?: unknown;
  job_types?: unknown;
  location?: unknown;
  created_at?: unknown;
}

interface ArbeitnowResponse {
  data?: ArbeitnowJob[];
}

function cleanHtml(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const cleaned = value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function matchesCountry(
  location: unknown,
  remote: unknown,
  selectedCountry: string | undefined,
): boolean {
  if (!selectedCountry) return true;
  if (remote === true) return true;
  if (typeof location !== "string") return true;

  const normalizedCountry = normalizeCountryKey(selectedCountry);
  const normalizedLoc = location.toLowerCase().trim();
  return (
    normalizedLoc.includes(normalizedCountry) ||
    normalizeCountryKey(normalizedLoc) === normalizedCountry
  );
}

function matchesSearchTerm(job: ArbeitnowJob, term: string): boolean {
  const normTerm = term.toLowerCase().trim();
  if (!normTerm) return true;

  const title = typeof job.title === "string" ? job.title.toLowerCase() : "";
  if (title.includes(normTerm)) return true;

  if (Array.isArray(job.tags)) {
    const hasTag = job.tags.some(
      (t) => typeof t === "string" && t.toLowerCase().includes(normTerm),
    );
    if (hasTag) return true;
  }

  const desc =
    typeof job.description === "string" ? job.description.toLowerCase() : "";
  return desc.includes(normTerm);
}

function toCreateJobInput(job: ArbeitnowJob): CreateJobInput | null {
  const title = typeof job.title === "string" ? job.title.trim() : "";
  const jobUrl = typeof job.url === "string" ? job.url.trim() : "";
  if (!title || !jobUrl) return null;

  const employer =
    typeof job.company_name === "string" && job.company_name.trim()
      ? job.company_name.trim()
      : "Unknown Employer";

  const sourceJobId =
    typeof job.slug === "string" && job.slug.trim() ? job.slug.trim() : jobUrl;

  const description = cleanHtml(job.description);
  const skills = Array.isArray(job.tags)
    ? job.tags.filter((t): t is string => typeof t === "string").join(", ")
    : undefined;
  const jobType = Array.isArray(job.job_types)
    ? job.job_types.filter((t): t is string => typeof t === "string").join(", ")
    : undefined;

  let datePosted: string | undefined;
  if (typeof job.created_at === "number") {
    datePosted = new Date(job.created_at * 1000).toISOString();
  }

  return {
    source: "arbeitnow",
    sourceJobId,
    title,
    employer,
    jobUrl,
    applicationLink: jobUrl,
    location:
      typeof job.location === "string" ? job.location : "Remote / Europe",
    datePosted,
    jobType,
    skills,
    isRemote: job.remote === true,
    jobDescription: description ? description.slice(0, 4000) : undefined,
  };
}

export async function runArbeitnow(
  options: RunArbeitnowOptions = {},
): Promise<ArbeitnowResult> {
  const searchTerms = options.searchTerms?.filter(
    (t) => t.trim().length > 0,
  ) ?? ["developer"];
  const termTotal = searchTerms.length;
  const maxJobsPerTerm = Math.max(1, options.maxJobsPerTerm ?? 50);
  const fetchImpl = options.fetchImpl ?? fetch;

  const jobs: CreateJobInput[] = [];
  const seenJobUrls = new Set<string>();

  let cachedApiResponse: ArbeitnowJob[] | null = null;

  try {
    const response = await fetchImpl(ARBEITNOW_API_URL, {
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      return {
        success: false,
        jobs: [],
        error: `Arbeitnow API returned HTTP ${response.status}`,
      };
    }

    const payload = (await response.json()) as ArbeitnowResponse;
    cachedApiResponse = Array.isArray(payload.data) ? payload.data : [];
  } catch (error) {
    return {
      success: false,
      jobs: [],
      error: `Arbeitnow fetch error: ${error instanceof Error ? error.message : "unknown error"}`,
    };
  }

  for (let termIndex = 1; termIndex <= termTotal; termIndex += 1) {
    if (options.shouldCancel?.()) break;

    const searchTerm = searchTerms[termIndex - 1];
    options.onProgress?.({
      type: "term_start",
      termIndex,
      termTotal,
      searchTerm,
    });

    let jobsFoundTerm = 0;

    for (const rawJob of cachedApiResponse) {
      if (jobsFoundTerm >= maxJobsPerTerm) break;
      if (
        !matchesCountry(rawJob.location, rawJob.remote, options.selectedCountry)
      )
        continue;
      if (!matchesSearchTerm(rawJob, searchTerm)) continue;

      const job = toCreateJobInput(rawJob);
      if (!job) continue;
      if (seenJobUrls.has(job.jobUrl)) continue;

      seenJobUrls.add(job.jobUrl);
      jobs.push(job);
      jobsFoundTerm += 1;
    }

    options.onProgress?.({
      type: "term_complete",
      termIndex,
      termTotal,
      searchTerm,
      jobsFoundTerm,
    });
  }

  return { success: true, jobs };
}
