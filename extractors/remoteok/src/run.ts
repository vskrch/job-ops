import { normalizeCountryKey } from "@shared/location-support.js";
import type { CreateJobInput } from "@shared/types/jobs";

const REMOTEOK_API_URL = "https://remoteok.com/api";

export interface RemoteOkProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunRemoteOkOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  onProgress?: (event: RemoteOkProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface RemoteOkResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface RemoteOkJob {
  id?: unknown;
  slug?: unknown;
  company?: unknown;
  position?: unknown;
  location?: unknown;
  tags?: unknown;
  salary_min?: unknown;
  salary_max?: unknown;
  salary_currency?: unknown;
  date?: unknown;
  url?: unknown;
  apply_url?: unknown;
  description?: unknown;
}

const FLAG_TO_COUNTRY: Record<string, string> = {
  "🇺🇸": "usa",
  "🇨🇦": "canada",
  "🇮🇳": "india",
  "🇬🇧": "united kingdom",
  "🇪🇺": "europe",
  "🇦🇺": "australia",
  "🇩🇪": "germany",
  "🇫🇷": "france",
  "🇳🇱": "netherlands",
  "🇸🇬": "singapore",
  "🇯🇵": "japan",
  "🇧🇷": "brazil",
  "🇲🇽": "mexico",
};

const GLOBAL_REMOTE_LOCATIONS = new Set([
  "worldwide",
  "anywhere",
  "global",
  "earth",
  "remote",
]);

function locationHints(location: string): string[] {
  const hints: string[] = [];
  for (const flag of Object.keys(FLAG_TO_COUNTRY)) {
    if (location.includes(flag)) hints.push(FLAG_TO_COUNTRY[flag]);
  }
  const text = location
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (text) hints.push(text);
  return hints;
}

function matchesSelectedCountry(
  location: string,
  selectedCountry: string | undefined,
): boolean {
  if (!selectedCountry) return true;
  const normalizedCountry = normalizeCountryKey(selectedCountry);
  const hints = locationHints(location);
  if (hints.some((hint) => GLOBAL_REMOTE_LOCATIONS.has(hint))) return true;
  return hints.some((hint) => {
    const normalized = normalizeCountryKey(hint);
    return (
      normalized === normalizedCountry || normalized.includes(normalizedCountry)
    );
  });
}

function matchesSearchTerm(job: RemoteOkJob, searchTerm: string): boolean {
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
    typeof job.position === "string" ? job.position : "",
    typeof job.description === "string" ? job.description : "",
    typeof job.company === "string" ? job.company : "",
    typeof job.location === "string" ? job.location : "",
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

function toNumber(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export async function runRemoteOk(
  options: RunRemoteOkOptions = {},
): Promise<RemoteOkResult> {
  const {
    searchTerms = [""],
    selectedCountry,
    maxJobsPerTerm = 50,
    onProgress,
    shouldCancel,
    fetchImpl = fetch,
  } = options;

  try {
    const response = await fetchImpl(REMOTEOK_API_URL, {
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`RemoteOK API returned ${response.status}`);
    }
    const payload = (await response.json()) as RemoteOkJob[];
    const feedJobs = Array.isArray(payload) ? payload.slice(1) : [];

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

      let termJobs = 0;
      for (const job of feedJobs) {
        const location = typeof job.location === "string" ? job.location : "";
        if (!matchesSelectedCountry(location, selectedCountry)) continue;
        if (!matchesSearchTerm(job, searchTerm)) continue;
        if (termJobs >= maxJobsPerTerm) break;

        const title =
          typeof job.position === "string" ? job.position : "Unknown role";
        const employer =
          typeof job.company === "string" ? job.company : "Unknown";
        const salaryMin = toNumber(job.salary_min);
        const salaryMax = toNumber(job.salary_max);
        const currency =
          typeof job.salary_currency === "string"
            ? job.salary_currency
            : undefined;

        jobs.push({
          source: "remoteok",
          title,
          employer,
          jobUrl:
            typeof job.url === "string" ? job.url : "https://remoteok.com",
          applicationLink:
            typeof job.apply_url === "string" ? job.apply_url : undefined,
          location: location || "Remote (Worldwide)",
          jobDescription: stripHtml(
            typeof job.description === "string" ? job.description : "",
          ),
          isRemote: true,
          datePosted:
            typeof job.date === "string"
              ? new Date(job.date).toISOString()
              : undefined,
          sourceJobId:
            typeof job.id === "string" || typeof job.id === "number"
              ? String(job.id)
              : typeof job.slug === "string"
                ? job.slug
                : undefined,
          salary:
            salaryMin && salaryMax
              ? `$${salaryMin.toLocaleString()} - $${salaryMax.toLocaleString()}${currency ? ` ${currency}` : ""}`
              : salaryMin
                ? `$${salaryMin.toLocaleString()}${currency ? ` ${currency}` : ""}`
                : undefined,
          salaryMinAmount: salaryMin,
          salaryMaxAmount: salaryMax,
          salaryCurrency: currency ?? "USD",
          salaryInterval: "yearly",
          salarySource: "remoteok",
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
    }

    return { success: true, jobs };
  } catch (error) {
    return {
      success: false,
      jobs: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
