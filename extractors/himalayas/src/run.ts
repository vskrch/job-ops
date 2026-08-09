import type { CreateJobInput } from "@shared/types/jobs";

const HIMALAYAS_API = "https://himalayas.app/jobs/api";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DEFAULT_MAX_JOBS = 100;
const PAGE_SIZE = 100;

export interface HimalayasProgressEvent {
  type: "page_fetched" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunHimalayasOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  onProgress?: (event: HimalayasProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface HimalayasResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface HimalayasJob {
  title?: string;
  companyName?: string;
  applicationLink?: string;
  description?: string;
  excerpt?: string;
  locationRestrictions?: string[];
  minSalary?: number | null;
  maxSalary?: number | null;
  currency?: string;
  salaryPeriod?: string;
  employmentType?: string;
  pubDate?: string;
  expiryDate?: string;
  guid?: string;
  categories?: string[];
}

function toStr(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parsePubDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const ts = Number(raw);
  if (!Number.isFinite(ts) || ts <= 0) return undefined;
  return new Date(ts * 1000).toISOString();
}

function mapJob(job: HimalayasJob): CreateJobInput | undefined {
  const title = toStr(job.title)?.trim();
  const jobUrl = toStr(job.applicationLink)?.trim();
  if (!title || !jobUrl) return undefined;

  const location = Array.isArray(job.locationRestrictions)
    ? job.locationRestrictions.join(", ")
    : "Remote";
  const isRemote = /remote/i.test(location);

  const minSalary =
    typeof job.minSalary === "number" && Number.isFinite(job.minSalary)
      ? job.minSalary
      : undefined;
  const maxSalary =
    typeof job.maxSalary === "number" && Number.isFinite(job.maxSalary)
      ? job.maxSalary
      : undefined;
  const currency = toStr(job.currency)?.trim() ?? "USD";
  const salaryPeriod =
    toStr(job.salaryPeriod)?.trim() === "hourly" ? "hourly" : "yearly";

  const salaryParts: string[] = [];
  if (minSalary != null || maxSalary != null) {
    salaryParts.push(
      `${currency} ${minSalary != null ? minSalary.toLocaleString("en-US") : "?"} - ${maxSalary != null ? maxSalary.toLocaleString("en-US") : "?"} ${salaryPeriod === "hourly" ? "per hour" : "per year"}`,
    );
  }
  const salary = salaryParts.length > 0 ? salaryParts.join(" ") : undefined;

  return {
    source: "himalayas",
    sourceJobId: toStr(job.guid)?.trim() || undefined,
    title,
    employer: toStr(job.companyName)?.trim() || "Unknown Employer",
    jobUrl,
    applicationLink: jobUrl,
    jobDescription: toStr(job.description) ?? toStr(job.excerpt) ?? undefined,
    location: location || "Remote",
    salary,
    salaryMinAmount: minSalary,
    salaryMaxAmount: maxSalary,
    salaryCurrency: currency,
    salaryInterval: salaryPeriod,
    jobType: toStr(job.employmentType)?.trim() || undefined,
    isRemote,
    datePosted: parsePubDate(toStr(job.pubDate)),
    companyIndustry: Array.isArray(job.categories)
      ? job.categories.slice(0, 3).join(", ")
      : undefined,
  };
}

export async function runHimalayas(
  options: RunHimalayasOptions = {},
): Promise<HimalayasResult> {
  const {
    searchTerms = ["software engineer"],
    maxJobsPerTerm = DEFAULT_MAX_JOBS,
    onProgress,
    shouldCancel,
    fetchImpl = fetch,
  } = options;

  const jobs: CreateJobInput[] = [];
  const seen = new Set<string>();
  const termErrors: string[] = [];

  for (let termIndex = 0; termIndex < searchTerms.length; termIndex++) {
    if (shouldCancel?.()) break;
    const searchTerm = searchTerms[termIndex] ?? "";
    let termJobs = 0;
    let termError: string | undefined;

    try {
      let offset = 0;
      while (termJobs < maxJobsPerTerm) {
        if (shouldCancel?.()) break;
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        if (searchTerm.trim()) params.set("q", searchTerm.trim());

        const response = await fetchImpl(
          `${HIMALAYAS_API}?${params.toString()}`,
          {
            headers: {
              accept: "application/json",
              "user-agent": USER_AGENT,
            },
          },
        );
        if (!response.ok) {
          termError = `Himalayas returned HTTP ${response.status}`;
          break;
        }

        const payload = (await response.json()) as {
          jobs?: HimalayasJob[];
        };
        const pageJobs = Array.isArray(payload.jobs) ? payload.jobs : [];
        if (pageJobs.length === 0) break;

        let addedOnPage = 0;
        for (const rawJob of pageJobs) {
          if (termJobs >= maxJobsPerTerm) break;
          const mapped = mapJob(rawJob);
          if (!mapped) continue;
          const key = mapped.jobUrl;
          if (seen.has(key)) continue;
          seen.add(key);
          jobs.push(mapped);
          termJobs += 1;
          addedOnPage += 1;
        }

        onProgress?.({
          type: "page_fetched",
          termIndex: termIndex + 1,
          termTotal: searchTerms.length,
          searchTerm,
          jobsFoundTerm: termJobs,
        });

        if (addedOnPage === 0) break;
        offset += PAGE_SIZE;
      }
    } catch (error) {
      termError = error instanceof Error ? error.message : String(error);
    }

    if (termError) {
      termErrors.push(`"${searchTerm}": ${termError}`);
    }
    onProgress?.({
      type: "term_complete",
      termIndex: termIndex + 1,
      termTotal: searchTerms.length,
      searchTerm,
      jobsFoundTerm: termJobs,
    });
  }

  if (termErrors.length > 0 && jobs.length === 0) {
    return { success: false, jobs, error: termErrors.join("; ") };
  }
  if (termErrors.length > 0) {
    return { success: true, jobs, error: termErrors.join("; ") };
  }
  return { success: true, jobs };
}
