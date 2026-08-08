import { normalizeCountryKey } from "@shared/location-support.js";
import type { CreateJobInput } from "@shared/types/jobs";

const HN_SEARCH_URL = "https://hn.algolia.com/api/v1/search";
const HN_ITEM_URL = "https://hn.algolia.com/api/v1/items";

export interface HnHiringProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunHnHiringOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  onProgress?: (event: HnHiringProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface HnHiringResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface HnItem {
  objectID?: string;
  id?: number;
  title?: string;
  author?: string;
  created_at?: string;
  text?: string;
  children?: HnItem[];
  url?: string;
}

interface HnSearchHit {
  objectID?: string;
  title?: string;
  created_at?: string;
}

interface HnSearchResponse {
  hits?: HnSearchHit[];
}

const GLOBAL_REMOTE_LOCATIONS = new Set([
  "remote",
  "worldwide",
  "anywhere",
  "global",
  "earth",
  "anywhere in the world",
  "remote (worldwide)",
  "worldwide (remote)",
]);

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function extractUrl(text: string): string | undefined {
  const match = /https?:\/\/[^\s|<>"']+/.exec(text);
  return match?.[0] ?? undefined;
}

function matchesSelectedCountry(
  location: string,
  selectedCountry: string | undefined,
): boolean {
  if (!selectedCountry) return true;
  const normalizedLocation = location
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedLocation) return false;
  if (GLOBAL_REMOTE_LOCATIONS.has(normalizedLocation)) return true;
  const normalizedCountry = normalizeCountryKey(selectedCountry);
  return (
    normalizeCountryKey(normalizedLocation) === normalizedCountry ||
    normalizedLocation.includes(normalizedCountry)
  );
}

function matchesSearchTerm(text: string, searchTerm: string): boolean {
  const normalizedTerm = searchTerm
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedTerm) return true;
  const haystack = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalizedTerm
    .split(" ")
    .filter(Boolean)
    .every((token) => haystack.includes(token));
}

function parseJobTableLine(line: string): {
  cells: string[];
  raw: string;
} {
  const trimmed = line.trim();
  const cells = trimmed
    .split("|")
    .map((cell) => cell.trim())
    .filter((_cell, index, array) => index > 0 && index < array.length - 1)
    .map((cell) => stripHtml(cell));
  return { cells, raw: trimmed };
}

function buildJobsFromComment(
  comment: HnItem,
  searchTerm: string,
  selectedCountry: string | undefined,
): CreateJobInput[] {
  const jobs: CreateJobInput[] = [];
  const rawText = typeof comment.text === "string" ? comment.text : "";
  if (!rawText) return jobs;

  const lines = rawText
    .split(/<p[^>]*>|<\/p>|<br\s*\/?>|\r?\n/i)
    .map((line) => stripHtml(line))
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const { cells, raw } = parseJobTableLine(line);
    if (cells.length < 2) continue;

    const [company = "", title = "", location = ""] = cells;
    if (!company || !title) continue;
    if (!matchesSearchTerm(raw, searchTerm)) continue;
    if (location && !matchesSelectedCountry(location, selectedCountry))
      continue;

    const jobUrl =
      extractUrl(raw) ??
      `https://news.ycombinator.com/item?id=${comment.objectID ?? comment.id ?? ""}`;
    jobs.push({
      source: "hnhiring",
      title: title || "Unknown role",
      employer: company,
      jobUrl,
      applicationLink: extractUrl(raw),
      location: location || "Remote",
      jobDescription: raw,
      isRemote: !location || /remote|worldwide|anywhere/i.test(location),
      datePosted: comment.created_at
        ? new Date(comment.created_at).toISOString()
        : undefined,
      listingType: "Hacker News monthly hiring thread",
    });
  }
  return jobs;
}

export async function runHnHiring(
  options: RunHnHiringOptions = {},
): Promise<HnHiringResult> {
  const {
    searchTerms = [""],
    selectedCountry,
    maxJobsPerTerm = 50,
    onProgress,
    shouldCancel,
    fetchImpl = fetch,
  } = options;

  try {
    const threadResponse = await fetchImpl(
      `${HN_SEARCH_URL}?tags=story&query=${encodeURIComponent("Who is hiring")}&hitsPerPage=3`,
      { headers: { accept: "application/json" } },
    );
    if (!threadResponse.ok) {
      throw new Error(`HN search returned ${threadResponse.status}`);
    }
    const threadPayload = (await threadResponse.json()) as HnSearchResponse;
    const thread = threadPayload.hits?.[0];
    if (!thread?.objectID) {
      return { success: true, jobs: [] };
    }

    const itemResponse = await fetchImpl(`${HN_ITEM_URL}/${thread.objectID}`, {
      headers: { accept: "application/json" },
    });
    if (!itemResponse.ok) {
      throw new Error(`HN item fetch returned ${itemResponse.status}`);
    }
    const item = (await itemResponse.json()) as HnItem;

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
      for (const comment of item.children ?? []) {
        if (shouldCancel?.()) return { success: true, jobs };
        for (const job of buildJobsFromComment(
          comment,
          searchTerm,
          selectedCountry,
        )) {
          if (termJobs >= maxJobsPerTerm) break;
          jobs.push(job);
          termJobs += 1;
        }
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
