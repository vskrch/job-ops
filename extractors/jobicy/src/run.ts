import { normalizeCountryKey } from "@shared/location-support.js";
import type { CreateJobInput } from "@shared/types/jobs";

const JOBICY_API_URL = "https://jobicy.com/api/v2/remote-jobs";

export interface JobicyProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunJobicyOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  onProgress?: (event: JobicyProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface JobicyResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface JobicyJob {
  id?: unknown;
  url?: unknown;
  jobTitle?: unknown;
  companyName?: unknown;
  companyLogo?: unknown;
  jobIndustry?: unknown;
  jobType?: unknown;
  jobGeo?: unknown;
  jobLevel?: unknown;
  jobExcerpt?: unknown;
  jobDescription?: unknown;
  pubDate?: unknown;
  annualSalaryMin?: unknown;
  annualSalaryMax?: unknown;
  salaryCurrency?: unknown;
}

interface JobicyResponse {
  jobs?: JobicyJob[];
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

function formatSalary(job: JobicyJob): string | undefined {
  const min =
    typeof job.annualSalaryMin === "number" ? job.annualSalaryMin : undefined;
  const max =
    typeof job.annualSalaryMax === "number" ? job.annualSalaryMax : undefined;
  const currency =
    typeof job.salaryCurrency === "string" ? job.salaryCurrency : "USD";
  if (min && max) {
    return `${currency} ${min.toLocaleString()} - ${max.toLocaleString()}`;
  }
  if (min) {
    return `${currency} ${min.toLocaleString()}+`;
  }
  return undefined;
}

function matchesCountry(
  geo: unknown,
  selectedCountry: string | undefined,
): boolean {
  if (!selectedCountry || typeof geo !== "string") return true;
  const normalizedCountry = normalizeCountryKey(selectedCountry);
  const normalizedGeo = geo.toLowerCase().trim();
  if (
    normalizedGeo.includes("anywhere") ||
    normalizedGeo.includes("worldwide") ||
    normalizedGeo.includes("global") ||
    normalizedGeo.includes("remote")
  ) {
    return true;
  }
  return (
    normalizedGeo.includes(normalizedCountry) ||
    normalizeCountryKey(normalizedGeo) === normalizedCountry
  );
}

function toCreateJobInput(job: JobicyJob): CreateJobInput | null {
  const title = typeof job.jobTitle === "string" ? job.jobTitle.trim() : "";
  const jobUrl = typeof job.url === "string" ? job.url.trim() : "";
  if (!title || !jobUrl) return null;

  const employer =
    typeof job.companyName === "string" && job.companyName.trim()
      ? job.companyName.trim()
      : "Unknown Employer";

  const sourceJobId =
    typeof job.id === "number" || typeof job.id === "string"
      ? String(job.id)
      : jobUrl;

  const description =
    cleanHtml(job.jobDescription) || cleanHtml(job.jobExcerpt);

  return {
    source: "jobicy",
    sourceJobId,
    title,
    employer,
    jobUrl,
    applicationLink: jobUrl,
    location: typeof job.jobGeo === "string" ? job.jobGeo : "Remote",
    salary: formatSalary(job),
    datePosted: typeof job.pubDate === "string" ? job.pubDate : undefined,
    jobType: typeof job.jobType === "string" ? job.jobType : undefined,
    jobLevel: typeof job.jobLevel === "string" ? job.jobLevel : undefined,
    isRemote: true,
    jobDescription: description ? description.slice(0, 4000) : undefined,
  };
}

export async function runJobicy(
  options: RunJobicyOptions = {},
): Promise<JobicyResult> {
  const searchTerms = options.searchTerms?.filter(
    (t) => t.trim().length > 0,
  ) ?? ["developer"];
  const termTotal = searchTerms.length;
  const maxJobsPerTerm = Math.max(1, options.maxJobsPerTerm ?? 50);
  const fetchImpl = options.fetchImpl ?? fetch;

  const jobs: CreateJobInput[] = [];
  const seenJobUrls = new Set<string>();
  const failures: string[] = [];

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

    try {
      const url = `${JOBICY_API_URL}?count=50&tag=${encodeURIComponent(searchTerm)}`;
      const response = await fetchImpl(url, {
        headers: {
          accept: "application/json",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
      });

      if (!response.ok) {
        failures.push(
          `Jobicy API HTTP ${response.status} for term "${searchTerm}"`,
        );
      } else {
        const payload = (await response.json()) as JobicyResponse;
        const rawJobs = Array.isArray(payload.jobs) ? payload.jobs : [];

        for (const rawJob of rawJobs) {
          if (jobsFoundTerm >= maxJobsPerTerm) break;
          if (!matchesCountry(rawJob.jobGeo, options.selectedCountry)) continue;

          const job = toCreateJobInput(rawJob);
          if (!job) continue;
          if (seenJobUrls.has(job.jobUrl)) continue;

          seenJobUrls.add(job.jobUrl);
          jobs.push(job);
          jobsFoundTerm += 1;
        }
      }
    } catch (error) {
      failures.push(
        `Jobicy fetch error for "${searchTerm}": ${error instanceof Error ? error.message : "unknown error"}`,
      );
    }

    options.onProgress?.({
      type: "term_complete",
      termIndex,
      termTotal,
      searchTerm,
      jobsFoundTerm,
    });
  }

  if (failures.length === termTotal && termTotal > 0 && jobs.length === 0) {
    return {
      success: false,
      jobs: [],
      error: failures.join("; "),
    };
  }

  return { success: true, jobs };
}
