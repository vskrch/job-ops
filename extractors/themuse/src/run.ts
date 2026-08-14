import { normalizeCountryKey } from "@shared/location-support.js";
import type { CreateJobInput } from "@shared/types/jobs";

const THE_MUSE_API_URL = "https://www.themuse.com/api/public/jobs";

export interface TheMuseProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunTheMuseOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  maxPagesPerTerm?: number;
  onProgress?: (event: TheMuseProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface TheMuseResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface TheMuseJob {
  id?: unknown;
  name?: unknown;
  contents?: unknown;
  publication_date?: unknown;
  levels?: Array<{ name?: unknown; short_name?: unknown }>;
  locations?: Array<{ name?: unknown }>;
  categories?: Array<{ name?: unknown }>;
  company?: { name?: unknown; short_name?: unknown };
  refs?: { landing_page?: unknown };
}

interface TheMuseResponse {
  page?: number;
  page_count?: number;
  total?: number;
  results?: TheMuseJob[];
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
  locations: Array<{ name?: unknown }> | undefined,
  selectedCountry: string | undefined,
): boolean {
  if (!selectedCountry) return true;
  if (!locations || locations.length === 0) return true;

  const normalizedCountry = normalizeCountryKey(selectedCountry);
  return locations.some((loc) => {
    if (typeof loc.name !== "string") return false;
    const lower = loc.name.toLowerCase();
    if (
      lower.includes("flexible / remote") ||
      lower.includes("remote") ||
      lower.includes("anywhere")
    ) {
      return true;
    }
    return (
      lower.includes(normalizedCountry) ||
      normalizeCountryKey(lower) === normalizedCountry
    );
  });
}

function matchesSearchTerm(job: TheMuseJob, term: string): boolean {
  const normTerm = term.toLowerCase().trim();
  if (!normTerm) return true;

  const name = typeof job.name === "string" ? job.name.toLowerCase() : "";
  if (name.includes(normTerm)) return true;

  if (Array.isArray(job.categories)) {
    const hasCategory = job.categories.some(
      (c) =>
        typeof c.name === "string" && c.name.toLowerCase().includes(normTerm),
    );
    if (hasCategory) return true;
  }

  const company =
    typeof job.company?.name === "string" ? job.company.name.toLowerCase() : "";
  if (company.includes(normTerm)) return true;

  const contents =
    typeof job.contents === "string" ? job.contents.toLowerCase() : "";
  return contents.includes(normTerm);
}

function toCreateJobInput(job: TheMuseJob): CreateJobInput | null {
  const title = typeof job.name === "string" ? job.name.trim() : "";
  const landingPage =
    typeof job.refs?.landing_page === "string"
      ? job.refs.landing_page.trim()
      : "";
  if (!title || !landingPage) return null;

  const employer =
    typeof job.company?.name === "string" && job.company.name.trim()
      ? job.company.name.trim()
      : "Unknown Employer";

  const sourceJobId =
    typeof job.id === "number" || typeof job.id === "string"
      ? String(job.id)
      : landingPage;

  const description = cleanHtml(job.contents);
  const location =
    Array.isArray(job.locations) && job.locations.length > 0
      ? job.locations
          .map((l) => (typeof l.name === "string" ? l.name : ""))
          .filter(Boolean)
          .join("; ")
      : undefined;

  const level =
    Array.isArray(job.levels) &&
    job.levels.length > 0 &&
    typeof job.levels[0]?.name === "string"
      ? job.levels[0].name
      : undefined;

  const isRemote = location ? location.toLowerCase().includes("remote") : false;

  return {
    source: "themuse",
    sourceJobId,
    title,
    employer,
    jobUrl: landingPage,
    applicationLink: landingPage,
    location,
    jobLevel: level,
    datePosted:
      typeof job.publication_date === "string"
        ? job.publication_date
        : undefined,
    isRemote,
    jobDescription: description ? description.slice(0, 4000) : undefined,
  };
}

export async function runTheMuse(
  options: RunTheMuseOptions = {},
): Promise<TheMuseResult> {
  const searchTerms = options.searchTerms?.filter(
    (t) => t.trim().length > 0,
  ) ?? ["software"];
  const termTotal = searchTerms.length;
  const maxJobsPerTerm = Math.max(1, options.maxJobsPerTerm ?? 50);
  const maxPages = Math.max(1, options.maxPagesPerTerm ?? 3);
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

    for (let page = 1; page <= maxPages; page += 1) {
      if (options.shouldCancel?.()) break;
      if (jobsFoundTerm >= maxJobsPerTerm) break;

      try {
        const url = `${THE_MUSE_API_URL}?category=Software%20Engineering&category=Data%20and%20Analytics&page=${page}`;
        const response = await fetchImpl(url, {
          headers: {
            accept: "application/json",
            "user-agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        });

        if (!response.ok) {
          failures.push(
            `The Muse API returned HTTP ${response.status} on page ${page}`,
          );
          break;
        }

        const payload = (await response.json()) as TheMuseResponse;
        const rawJobs = Array.isArray(payload.results) ? payload.results : [];

        if (rawJobs.length === 0) break;

        for (const rawJob of rawJobs) {
          if (jobsFoundTerm >= maxJobsPerTerm) break;
          if (!matchesCountry(rawJob.locations, options.selectedCountry))
            continue;
          if (!matchesSearchTerm(rawJob, searchTerm)) continue;

          const job = toCreateJobInput(rawJob);
          if (!job) continue;
          if (seenJobUrls.has(job.jobUrl)) continue;

          seenJobUrls.add(job.jobUrl);
          jobs.push(job);
          jobsFoundTerm += 1;
        }

        if (payload.page_count && page >= payload.page_count) break;
      } catch (error) {
        failures.push(
          `The Muse fetch error for "${searchTerm}": ${error instanceof Error ? error.message : "unknown error"}`,
        );
        break;
      }
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
