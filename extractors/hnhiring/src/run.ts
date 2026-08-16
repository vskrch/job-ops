import { normalizeCountryKey } from "@shared/location-support.js";
import type { CreateJobInput } from "@shared/types/jobs";

const HNHIRING_BASE_URL = "https://hnhiring.com";
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
  "wfh",
  "telecommute",
]);

const COUNTRY_NAME_MAPPINGS: Record<string, string> = {
  us: "united states",
  usa: "united states",
  uk: "united kingdom",
  ca: "canada",
  in: "india",
  de: "germany",
  fr: "france",
  au: "australia",
  nl: "netherlands",
  sg: "singapore",
  jp: "japan",
  br: "brazil",
  mx: "mexico",
};

export function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractUrl(text: string): string | undefined {
  const match = /(?:https?:\/\/|mailto:)[^\s|<>"'()\]]+/i.exec(text);
  if (!match) return undefined;
  const url = match[0].replace(/[.,;:)]+$/, "");
  return url;
}

export function extractEmail(text: string): string | undefined {
  const match = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.exec(text);
  return match ? `mailto:${match[0]}` : undefined;
}

export function extractSalary(text: string): string | undefined {
  const salaryMatch =
    /(?:[$€£₹]|(?:USD|EUR|GBP|INR|CAD|AUD)\s*)\s*\d{1,3}(?:[,\s]\d{3})*(?:\s*k|\s*K)?(?:\s*(?:-|–|to)\s*(?:[$€£₹]|(?:USD|EUR|GBP|INR|CAD|AUD)\s*)?\d{1,3}(?:[,\s]\d{3})*(?:\s*k|\s*K)?)?(?:\s*(?:\/|\s*per\s*)(?:yr|year|annum|hr|hour|mo|month))?|\b\d{1,3}(?:-\d{1,3})?\s*LPA\b/i.exec(
      text,
    );
  return salaryMatch ? salaryMatch[0].trim() : undefined;
}

export function matchesSelectedCountry(
  location: string,
  selectedCountry: string | undefined,
  isRemote?: boolean,
): boolean {
  if (!selectedCountry) return true;
  const normalizedCountry = normalizeCountryKey(selectedCountry);
  if (!normalizedCountry) return true;

  const normalizedLocation = location
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (isRemote || GLOBAL_REMOTE_LOCATIONS.has(normalizedLocation)) {
    // If it is remote with country restriction e.g. "Remote (US only)", check if compatible
    const words = normalizedLocation.split(/\s+/);
    for (const [abbr, full] of Object.entries(COUNTRY_NAME_MAPPINGS)) {
      if (words.includes(abbr) || normalizedLocation.includes(full)) {
        return (
          full === normalizedCountry ||
          normalizeCountryKey(abbr) === normalizedCountry
        );
      }
    }
    return true;
  }

  if (!normalizedLocation) return true;

  const locCountry = normalizeCountryKey(normalizedLocation);
  if (
    locCountry === normalizedCountry ||
    normalizedLocation.includes(normalizedCountry)
  ) {
    return true;
  }

  for (const [abbr, full] of Object.entries(COUNTRY_NAME_MAPPINGS)) {
    if (
      (normalizedLocation === abbr ||
        normalizedLocation.includes(` ${abbr} `) ||
        normalizedLocation.endsWith(` ${abbr}`)) &&
      (full === normalizedCountry ||
        normalizeCountryKey(abbr) === normalizedCountry)
    ) {
      return true;
    }
  }

  return false;
}

export function matchesSearchTerm(text: string, searchTerm: string): boolean {
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

interface ParsedHeader {
  employer: string;
  title: string;
  location: string;
  isRemote: boolean;
  salary?: string;
}

export function parseJobHeader(firstLine: string): ParsedHeader {
  let cleanLine = firstLine
    .replace(/^[-*•]\s+/, "")
    .replace(/^\[[^\]]+\]\([^)]+\)\s*/i, "")
    .trim();

  cleanLine = cleanLine
    .replace(
      /^(?:[a-zA-Z0-9_-]+\s+)?(?:about\s+\d+\s+\w+\s+ago|\d{4}-\d{2}-\d{2}(?:\s+\d{2}:\d{2}(?::\d{2})?)?|\d+\s+(?:hours?|days?|mins?|minutes?|months?)\s+ago)\s*/i,
      "",
    )
    .trim();

  // Check table syntax e.g. | Company | Title | Location | ...
  if (cleanLine.startsWith("|") && cleanLine.endsWith("|")) {
    const cells = cleanLine
      .split("|")
      .map((c) => c.trim())
      .filter(Boolean);
    const company = cells[0] || "Unknown Company";
    const title = cells[1] || "Software Engineer";
    const location = cells[2] || "Remote";
    const salary = extractSalary(cleanLine);
    const isRemote =
      /remote|worldwide|anywhere|global|wfh|telecommute/i.test(location) ||
      /remote|worldwide|anywhere|global|wfh|telecommute/i.test(cleanLine);
    return { employer: company, title, location, isRemote, salary };
  }

  // Split on pipe or bullet or em-dash or en-dash
  const pipeParts = cleanLine
    .split(/\s*[|•—–]\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (pipeParts.length >= 2) {
    let company = pipeParts[0];
    let title = pipeParts[1];
    let location = pipeParts[2] || "";

    // If part 0 looks like a role and part 1 looks like a company e.g. "Senior Engineer | Acme Corp"
    if (
      /\b(engineer|developer|manager|lead|architect|designer|scientist|analyst|intern|vp|director|devops|sre|cto)\b/i.test(
        company,
      ) &&
      !/\b(engineer|developer|manager|lead|architect|designer|scientist|analyst|intern|vp|director|devops|sre|cto)\b/i.test(
        title,
      )
    ) {
      const temp = company;
      company = title;
      title = temp;
    }

    const salary = extractSalary(cleanLine);
    const isRemote =
      /remote|worldwide|anywhere|global|wfh|telecommute/i.test(location) ||
      /remote|worldwide|anywhere|global|wfh|telecommute/i.test(cleanLine);

    if (!location) {
      location = isRemote ? "Remote" : "Unspecified";
    }

    return {
      employer: company,
      title: title || "Role",
      location,
      isRemote,
      salary,
    };
  }

  // Try "Company is hiring Title (Location)" or "Title at Company (Location)"
  const isHiringMatch =
    /^(.+?)\s+is\s+hiring\s+(?:a|an)?\s*(.+?)(?:\s+in\s+|\s*\((.+?)\)|\s*$)/i.exec(
      cleanLine,
    );
  if (isHiringMatch) {
    const company = isHiringMatch[1].trim();
    const title = isHiringMatch[2].trim();
    const location = (isHiringMatch[3] || "Remote").trim();
    const isRemote = /remote|worldwide|anywhere|global|wfh|telecommute/i.test(
      `${location} ${cleanLine}`,
    );
    return {
      employer: company,
      title: title || "Software Engineer",
      location: location || (isRemote ? "Remote" : "Unspecified"),
      isRemote,
      salary: extractSalary(cleanLine),
    };
  }

  const atCompanyMatch =
    /^(.+?)\s+at\s+(.+?)(?:\s*\((.+?)\)|\s+in\s+(.+?)|\s*$)/i.exec(cleanLine);
  if (atCompanyMatch) {
    const title = atCompanyMatch[1].trim();
    const company = atCompanyMatch[2].trim();
    const location = (
      atCompanyMatch[3] ||
      atCompanyMatch[4] ||
      "Remote"
    ).trim();
    const isRemote = /remote|worldwide|anywhere|global|wfh|telecommute/i.test(
      `${location} ${cleanLine}`,
    );
    return {
      employer: company,
      title: title || "Software Engineer",
      location: location || (isRemote ? "Remote" : "Unspecified"),
      isRemote,
      salary: extractSalary(cleanLine),
    };
  }

  // Fallback: use the first line
  const isRemote = /remote|worldwide|anywhere|global|wfh|telecommute/i.test(
    cleanLine,
  );
  return {
    employer: "Hacker News Hiring",
    title: cleanLine.slice(0, 80),
    location: isRemote ? "Remote" : "Unspecified",
    isRemote,
    salary: extractSalary(cleanLine),
  };
}

export function parseCommentToJob(
  rawText: string,
  commentMeta: {
    id?: string | number;
    created_at?: string;
    url?: string;
  },
  searchTerm: string,
  selectedCountry?: string,
): CreateJobInput | null {
  if (!rawText) return null;
  const stripped = stripHtml(rawText);
  if (stripped.length < 30) return null;

  if (!matchesSearchTerm(stripped, searchTerm)) {
    return null;
  }

  const lines = stripped
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const headerLine = lines[0] || stripped;
  const header = parseJobHeader(headerLine);

  if (
    !matchesSelectedCountry(header.location, selectedCountry, header.isRemote)
  ) {
    return null;
  }

  const applicationLink =
    extractUrl(stripped) ||
    extractEmail(stripped) ||
    (commentMeta.id
      ? `https://news.ycombinator.com/item?id=${commentMeta.id}`
      : undefined);

  const jobUrl =
    commentMeta.url ||
    (commentMeta.id
      ? `https://news.ycombinator.com/item?id=${commentMeta.id}`
      : applicationLink || HNHIRING_BASE_URL);

  return {
    source: "hnhiring",
    sourceJobId: commentMeta.id ? `hn-${commentMeta.id}` : undefined,
    title: header.title || "Software Engineer",
    employer: header.employer || "Hacker News Startup",
    jobUrl,
    applicationLink,
    location: header.location,
    salary: header.salary,
    jobDescription: stripped,
    isRemote: header.isRemote,
    datePosted: commentMeta.created_at
      ? new Date(commentMeta.created_at).toISOString()
      : new Date().toISOString(),
    listingType: "Hacker News Who is Hiring",
  };
}

/**
 * Scrapes job listings from https://hnhiring.com/ monthly and technology pages.
 */
export async function scrapeHnHiringDotCom(options: {
  searchTerms: string[];
  selectedCountry?: string;
  maxJobsPerTerm: number;
  fetchImpl: typeof fetch;
  shouldCancel?: () => boolean;
}): Promise<CreateJobInput[]> {
  const {
    searchTerms,
    selectedCountry,
    maxJobsPerTerm,
    fetchImpl,
    shouldCancel,
  } = options;
  const jobs: CreateJobInput[] = [];
  const seenUrls = new Set<string>();

  try {
    // 1. Fetch homepage to discover active monthly url e.g. /august-2026
    const homeRes = await fetchImpl(HNHIRING_BASE_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,text/plain",
      },
    });

    if (!homeRes.ok) {
      return jobs;
    }

    const homeHtml = await homeRes.text();
    // Find latest month link like href="/august-2026" or href="https://hnhiring.com/august-2026"
    const monthMatch =
      /href="(?:\/|https:\/\/hnhiring\.com\/)([a-z]+-\d{4})"/i.exec(homeHtml);
    const latestMonthPath = monthMatch ? `/${monthMatch[1]}` : "";

    const candidateUrls = [
      latestMonthPath ? `${HNHIRING_BASE_URL}${latestMonthPath}` : null,
      `${HNHIRING_BASE_URL}/locations/remote`,
    ].filter((u): u is string => Boolean(u));

    for (const pageUrl of candidateUrls) {
      if (shouldCancel?.()) break;

      const pageRes = await fetchImpl(pageUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,text/plain",
        },
      });

      if (!pageRes.ok) continue;
      const pageText = await pageRes.text();

      // Split page content into job entries
      // hnhiring.com renders jobs in <li> items or markdown entries "- [username](...)"
      const rawBlocks = pageText.includes("<li")
        ? pageText.split(/<li[^>]*>/i).slice(1)
        : pageText.split(/(?:^|\n)-\s+\[/g).slice(1);

      for (const block of rawBlocks) {
        if (shouldCancel?.()) break;
        const cleanBlock = stripHtml(block);
        if (cleanBlock.length < 40) continue;

        for (const term of searchTerms) {
          const job = parseCommentToJob(
            cleanBlock,
            { url: pageUrl },
            term,
            selectedCountry,
          );
          if (job) {
            const key = `${job.employer.toLowerCase()}|${job.title.toLowerCase()}`;
            if (!seenUrls.has(key)) {
              seenUrls.add(key);
              jobs.push(job);
            }
            if (
              jobs.length >=
              maxJobsPerTerm * Math.max(searchTerms.length, 1)
            ) {
              return jobs;
            }
          }
        }
      }
    }
  } catch {
    // Non-fatal fallback to Algolia
  }

  return jobs;
}

export async function runHnHiring(
  options: RunHnHiringOptions = {},
): Promise<HnHiringResult> {
  const {
    searchTerms = [""],
    selectedCountry,
    maxJobsPerTerm = 200,
    onProgress,
    shouldCancel,
    fetchImpl = fetch,
  } = options;

  try {
    const allDiscoveredJobs: CreateJobInput[] = [];
    const seenJobKeys = new Set<string>();

    // 1. Scrape directly from https://hnhiring.com/
    const webJobs = await scrapeHnHiringDotCom({
      searchTerms,
      selectedCountry,
      maxJobsPerTerm,
      fetchImpl,
      shouldCancel,
    });

    for (const job of webJobs) {
      const key = `${job.employer.toLowerCase()}|${job.title.toLowerCase()}`;
      if (!seenJobKeys.has(key)) {
        seenJobKeys.add(key);
        allDiscoveredJobs.push(job);
      }
    }

    // 2. Query Hacker News Algolia API for recent "Who is hiring?" monthly threads
    const threadResponse = await fetchImpl(
      `${HN_SEARCH_URL}?tags=story&query=${encodeURIComponent("Who is hiring")}&hitsPerPage=3`,
      { headers: { accept: "application/json" } },
    );

    let threadHits: HnSearchHit[] = [];
    if (threadResponse.ok) {
      const threadPayload = (await threadResponse.json()) as HnSearchResponse;
      threadHits = threadPayload.hits || [];
    }

    for (let termIndex = 0; termIndex < searchTerms.length; termIndex++) {
      if (shouldCancel?.()) return { success: true, jobs: allDiscoveredJobs };
      const searchTerm = searchTerms[termIndex] ?? "";

      onProgress?.({
        type: "term_start",
        termIndex: termIndex + 1,
        termTotal: searchTerms.length,
        searchTerm,
      });

      let termJobsCount = 0;

      for (const thread of threadHits) {
        if (!thread.objectID || shouldCancel?.()) break;

        const itemResponse = await fetchImpl(
          `${HN_ITEM_URL}/${thread.objectID}`,
          { headers: { accept: "application/json" } },
        );
        if (!itemResponse.ok) continue;

        const item = (await itemResponse.json()) as HnItem;

        for (const comment of item.children || []) {
          if (shouldCancel?.()) break;
          const rawText = typeof comment.text === "string" ? comment.text : "";
          if (!rawText) continue;

          const job = parseCommentToJob(
            rawText,
            {
              id: comment.objectID || comment.id,
              created_at: comment.created_at || thread.created_at,
            },
            searchTerm,
            selectedCountry,
          );

          if (job) {
            const key = `${job.employer.toLowerCase()}|${job.title.toLowerCase()}`;
            if (!seenJobKeys.has(key)) {
              seenJobKeys.add(key);
              allDiscoveredJobs.push(job);
              termJobsCount += 1;
            }
          }

          if (termJobsCount >= maxJobsPerTerm) break;
        }

        if (termJobsCount >= maxJobsPerTerm) break;
      }

      onProgress?.({
        type: "term_complete",
        termIndex: termIndex + 1,
        termTotal: searchTerms.length,
        searchTerm,
        jobsFoundTerm: termJobsCount,
      });
    }

    return { success: true, jobs: allDiscoveredJobs };
  } catch (error) {
    return {
      success: false,
      jobs: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
