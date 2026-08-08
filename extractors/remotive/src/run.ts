import { normalizeCountryKey } from "@shared/location-support.js";
import type { CreateJobInput } from "@shared/types/jobs";

const REMOTIVE_API_URL = "https://remotive.com/api/remote-jobs";

export interface RemotiveProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunRemotiveOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  onProgress?: (event: RemotiveProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface RemotiveResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface RemotiveJob {
  id?: unknown;
  url?: unknown;
  title?: unknown;
  company_name?: unknown;
  category?: unknown;
  tags?: unknown;
  job_type?: unknown;
  publication_date?: unknown;
  candidate_required_location?: unknown;
  salary?: unknown;
  description?: unknown;
}

interface RemotiveResponse {
  jobs?: RemotiveJob[];
}

const GLOBAL_REMOTE_LOCATIONS = new Set([
  "worldwide",
  "anywhere",
  "global",
  "remote",
  "earth",
]);

function normalizeJobType(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  switch (value) {
    case "full_time":
      return "Full-time";
    case "part_time":
      return "Part-time";
    case "contract":
      return "Contract";
    case "freelance":
      return "Freelance";
    case "internship":
      return "Internship";
    default:
      return undefined;
  }
}

function matchesSelectedCountry(
  location: string,
  selectedCountry: string | undefined,
): boolean {
  if (!selectedCountry) return true;
  const normalizedLocation = normalizeCountryKey(location);
  const normalizedCountry = normalizeCountryKey(selectedCountry);
  if (GLOBAL_REMOTE_LOCATIONS.has(normalizedLocation)) return true;
  if (normalizedLocation === normalizedCountry) return true;
  return normalizedLocation.includes(normalizedCountry);
}

function matchesSearchTerm(job: RemotiveJob, searchTerm: string): boolean {
  const normalizedTerm = searchTerm
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedTerm) return true;

  const tags = Array.isArray(job.tags)
    ? job.tags.filter((value): value is string => typeof value === "string")
    : [];
  const haystack = [
    typeof job.title === "string" ? job.title : "",
    typeof job.description === "string" ? job.description : "",
    typeof job.company_name === "string" ? job.company_name : "",
    typeof job.category === "string" ? job.category : "",
    ...tags,
  ]
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return normalizedTerm
    .split(" ")
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export async function runRemotive(
  options: RunRemotiveOptions = {},
): Promise<RemotiveResult> {
  const {
    searchTerms = [""],
    selectedCountry,
    maxJobsPerTerm = 50,
    onProgress,
    shouldCancel,
    fetchImpl = fetch,
  } = options;

  const jobs: CreateJobInput[] = [];

  for (let termIndex = 0; termIndex < searchTerms.length; termIndex++) {
    if (shouldCancel?.()) return { success: true, jobs };
    const searchTerm = searchTerms[termIndex] ?? "";
    onProgress?.({
      type: "term_start",
      termIndex: termIndex + 1,
      termTotal: searchTerms.length,
      searchTerm,
    });

    try {
      const params = new URLSearchParams({ limit: "50" });
      if (searchTerm.trim()) params.set("search", searchTerm.trim());
      const response = await fetchImpl(
        `${REMOTIVE_API_URL}?${params.toString()}`,
        {
          headers: {
            accept: "application/json",
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
          },
        },
      );
      if (!response.ok) {
        throw new Error(`Remotive API returned ${response.status}`);
      }
      const payload = (await response.json()) as RemotiveResponse;

      let termJobs = 0;
      for (const job of payload.jobs ?? []) {
        const location =
          typeof job.candidate_required_location === "string"
            ? job.candidate_required_location
            : "Remote";
        if (!matchesSelectedCountry(location, selectedCountry)) continue;
        if (!matchesSearchTerm(job, searchTerm)) continue;
        if (termJobs >= maxJobsPerTerm) break;

        const title =
          typeof job.title === "string" ? job.title : "Unknown role";
        const employer =
          typeof job.company_name === "string" ? job.company_name : "Unknown";
        const description = stripHtml(
          typeof job.description === "string" ? job.description : "",
        );

        jobs.push({
          source: "remotive",
          title,
          employer,
          jobUrl:
            typeof job.url === "string" ? job.url : "https://remotive.com",
          applicationLink: typeof job.url === "string" ? job.url : undefined,
          location,
          jobDescription: description,
          isRemote: true,
          datePosted:
            typeof job.publication_date === "string"
              ? new Date(job.publication_date).toISOString()
              : undefined,
          jobType: normalizeJobType(job.job_type),
          sourceJobId:
            typeof job.id === "number" || typeof job.id === "string"
              ? String(job.id)
              : undefined,
          salary:
            typeof job.salary === "string" && job.salary.trim()
              ? job.salary.trim()
              : undefined,
          companyIndustry:
            typeof job.category === "string" ? job.category : undefined,
          skills: Array.isArray(job.tags)
            ? job.tags
                .filter((value): value is string => typeof value === "string")
                .join(", ")
            : undefined,
        });
        termJobs += 1;
      }

      onProgress?.({
        type: "term_complete",
        termIndex: termIndex + 1,
        termTotal: searchTerms.length,
        searchTerm,
        jobsFoundTerm: termJobs,
      });
    } catch (error) {
      return {
        success: false,
        jobs,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return { success: true, jobs };
}
