import { normalizeCountryKey } from "@shared/location-support.js";
import type { CreateJobInput } from "@shared/types/jobs";

const WWR_RSS_URL = "https://weworkremotely.com/remote-jobs.rss";

export interface WwrProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunWwrOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  onProgress?: (event: WwrProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface WwrResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface WwrItem {
  title?: string;
  link?: string;
  description?: string;
  category?: string;
  pubDate?: string;
}

interface WwrRss {
  items: WwrItem[];
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'");
}

function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRss(xml: string): WwrRss {
  const items: WwrItem[] = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  const tagPattern = /<([a-zA-Z]+)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/g;

  for (const itemMatch of xml.matchAll(itemPattern)) {
    const item: WwrItem = {};
    for (const tagMatch of itemMatch[1].matchAll(tagPattern)) {
      const key = tagMatch[1].toLowerCase();
      const value = decodeXmlEntities(tagMatch[2].trim());
      if (key === "title") item.title = value;
      if (key === "link") item.link = value;
      if (key === "description") item.description = value;
      if (key === "category") item.category = value;
      if (key === "pubdate") item.pubDate = value;
    }
    items.push(item);
  }
  return { items };
}

function matchesSelectedCountry(
  description: string,
  selectedCountry: string | undefined,
): boolean {
  if (!selectedCountry) return true;
  const text = stripHtml(description).toLowerCase();
  const normalizedCountry = normalizeCountryKey(selectedCountry);
  if (/\b(worldwide|anywhere|global|remote)\b/.test(text)) return true;
  const countryMatch = text.match(
    /\b(usa|united states|us only|canada|india|uk|europe|australia|germany|france)\b/,
  );
  if (!countryMatch) return false;
  return normalizeCountryKey(countryMatch[1]) === normalizedCountry;
}

function matchesSearchTerm(item: WwrItem, searchTerm: string): boolean {
  const normalizedTerm = searchTerm
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizedTerm) return true;

  const haystack = [
    item.title ?? "",
    item.description ?? "",
    item.category ?? "",
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

export async function runWwr(options: RunWwrOptions = {}): Promise<WwrResult> {
  const {
    searchTerms = [""],
    selectedCountry,
    maxJobsPerTerm = 50,
    onProgress,
    shouldCancel,
    fetchImpl = fetch,
  } = options;

  try {
    const response = await fetchImpl(WWR_RSS_URL, {
      headers: {
        accept: "application/rss+xml, application/xml, text/xml",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
      },
    });
    if (!response.ok) {
      throw new Error(`We Work Remotely returned ${response.status}`);
    }
    const rss = parseRss(await response.text());

    const jobs: CreateJobInput[] = [];
    const seenUrls = new Set<string>();

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
      for (const item of rss.items) {
        const description = item.description ?? "";
        if (!matchesSelectedCountry(description, selectedCountry)) continue;
        if (!matchesSearchTerm(item, searchTerm)) continue;
        if (termJobs >= maxJobsPerTerm) break;

        const link = item.link ?? "https://weworkremotely.com";
        if (seenUrls.has(link)) continue;
        seenUrls.add(link);

        const title = item.title ?? "Unknown role";
        const separator = title.indexOf(": ");
        const employer =
          separator > 0 ? title.slice(0, separator).trim() : "Unknown";
        const role =
          separator > 0 ? title.slice(separator + 2).trim() : title.trim();
        const cleanDescription = stripHtml(description);

        jobs.push({
          source: "weworkremotely",
          title: role,
          employer,
          jobUrl: link,
          applicationLink: link,
          location: "Remote",
          jobDescription: cleanDescription,
          isRemote: true,
          datePosted: item.pubDate
            ? new Date(item.pubDate).toISOString()
            : undefined,
          listingType: item.category,
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
