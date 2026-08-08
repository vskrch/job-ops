import type { CreateJobInput } from "@shared/types/jobs";

const USAJOBS_API_URL = "https://data.usajobs.gov/api/search";
const USAJOBS_RESULTS_PER_PAGE = 50;

export interface UsaJobsProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunUsaJobsOptions {
  searchTerms?: string[];
  maxJobsPerTerm?: number;
  onProgress?: (event: UsaJobsProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface UsaJobsResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface UsaJobsLocation {
  CityName?: string;
  State?: string;
  CountryCode?: string;
}

interface UsaJobsDescriptor {
  PositionID?: string;
  PositionTitle?: string;
  OrganizationName?: string;
  PositionURI?: string;
  PositionLocation?: UsaJobsLocation[];
  PublicationStartDate?: string;
  ApplicationCloseDate?: string;
  JobSummary?: string;
  SalaryMin?: number;
  SalaryMax?: number;
  RateIntervalCode?: string;
  PositionOfferingType?: Array<{ Name?: string }>;
  JobGrade?: Array<{ Code?: string }>;
  ApplyURI?: string[];
}

interface UsaJobsSearchItem {
  MatchedObjectDescriptor?: UsaJobsDescriptor;
}

interface UsaJobsSearchResponse {
  SearchResult?: {
    SearchResultItems?: UsaJobsSearchItem[];
  };
}

function formatLocation(locations: UsaJobsLocation[] | undefined): string {
  const parts = (locations ?? [])
    .filter(
      (location) =>
        typeof location.CityName === "string" ||
        typeof location.State === "string",
    )
    .map((location) =>
      [location.CityName, location.State].filter(Boolean).join(", "),
    );
  return parts.length > 0 ? parts.join("; ") : "USA";
}

function formatSalary(
  min: number | undefined,
  max: number | undefined,
  interval: string | undefined,
): string | undefined {
  if (min === undefined && max === undefined) return undefined;
  const parts = [];
  if (min !== undefined) parts.push(`$${min.toLocaleString()}`);
  if (max !== undefined) parts.push(`$${max.toLocaleString()}`);
  const suffix =
    interval === "Per Year"
      ? " / year"
      : interval === "Per Hour"
        ? " / hour"
        : "";
  return `${parts.join(" - ")}${suffix}`.trim();
}

function matchesSearchTerm(
  job: UsaJobsDescriptor,
  searchTerm: string,
): boolean {
  const normalizedTerm = searchTerm
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedTerm) return true;

  const haystack = [
    job.PositionTitle ?? "",
    job.JobSummary ?? "",
    job.OrganizationName ?? "",
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

export async function runUsaJobs(
  options: RunUsaJobsOptions = {},
): Promise<UsaJobsResult> {
  const {
    searchTerms = [""],
    maxJobsPerTerm = 50,
    onProgress,
    shouldCancel,
    fetchImpl = fetch,
  } = options;

  const apiKey = process.env.USAJOBS_API_KEY?.trim();
  if (!apiKey) {
    return {
      success: true,
      jobs: [],
      error: "USAJOBS_API_KEY is not set; USAJOBS extractor disabled",
    };
  }

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
      const params = new URLSearchParams({
        ResultsPerPage: String(USAJOBS_RESULTS_PER_PAGE),
      });
      if (searchTerm.trim()) params.set("Keyword", searchTerm.trim());
      const response = await fetchImpl(
        `${USAJOBS_API_URL}?${params.toString()}`,
        {
          headers: {
            accept: "application/json",
            authorization: `Bearer ${apiKey}`,
            "user-agent":
              "job-ops-pipeline/1.0 (job-ops; public federal job discovery)",
          },
        },
      );
      if (!response.ok) {
        throw new Error(`USAJOBS API returned ${response.status}`);
      }
      const payload = (await response.json()) as UsaJobsSearchResponse;

      let termJobs = 0;
      for (const item of payload.SearchResult?.SearchResultItems ?? []) {
        const descriptor = item.MatchedObjectDescriptor;
        if (!descriptor?.PositionTitle) continue;
        if (!matchesSearchTerm(descriptor, searchTerm)) continue;
        if (termJobs >= maxJobsPerTerm) break;

        const offeringType = descriptor.PositionOfferingType?.[0]?.Name;
        const isRemote =
          typeof offeringType === "string" && /remote/i.test(offeringType);

        jobs.push({
          source: "usajobs",
          title: descriptor.PositionTitle,
          employer: descriptor.OrganizationName ?? "U.S. Government",
          employerUrl: "https://www.usajobs.gov",
          jobUrl: descriptor.PositionURI ?? "https://www.usajobs.gov",
          applicationLink: descriptor.ApplyURI?.[0],
          location: formatLocation(descriptor.PositionLocation),
          jobDescription: descriptor.JobSummary,
          datePosted: descriptor.PublicationStartDate
            ? new Date(descriptor.PublicationStartDate).toISOString()
            : undefined,
          deadline: descriptor.ApplicationCloseDate,
          salary: formatSalary(
            descriptor.SalaryMin,
            descriptor.SalaryMax,
            descriptor.RateIntervalCode,
          ),
          salaryMinAmount: descriptor.SalaryMin,
          salaryMaxAmount: descriptor.SalaryMax,
          salaryCurrency: "USD",
          salaryInterval:
            descriptor.RateIntervalCode === "Per Hour" ? "hourly" : "yearly",
          salarySource: "usajobs",
          sourceJobId: descriptor.PositionID,
          isRemote,
          jobLevel: descriptor.JobGrade?.[0]?.Code,
          listingType: "Federal government",
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
