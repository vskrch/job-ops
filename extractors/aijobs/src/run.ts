import type { CreateJobInput } from "@shared/types/jobs";

const AIJOBS_ORIGIN = "https://aijobs.net";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DEFAULT_MAX_JOBS = 50;
const MAX_PAGES = 5;
const CARD_RE =
  /<li class="d-flex justify-content-between position-relative pb-2 py-2 mb-1">([\s\S]*?)<\/li>/g;

export interface AiJobsProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunAiJobsOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  onProgress?: (event: AiJobsProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface AiJobsResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface AiJobsCard {
  title?: string;
  jobUrl?: string;
  salary?: string;
  skills?: string[];
  location?: string;
  level?: string;
  jobType?: string;
  isRemote?: boolean;
  dateText?: string;
}

function clean(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function firstGroup(content: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(content);
  return match?.[1];
}

function parseSalary(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const text = clean(raw);
  if (!/\$|€|£/.test(text)) return undefined;
  return text;
}

function parseDate(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const match = /(\d+)\s*(d|h|w|mo)\s*ago/i.exec(text);
  if (!match) return undefined;
  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2].toLowerCase();
  const ms =
    unit === "d"
      ? amount * 24 * 60 * 60 * 1000
      : unit === "h"
        ? amount * 60 * 60 * 1000
        : unit === "w"
          ? amount * 7 * 24 * 60 * 60 * 1000
          : amount * 30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

function parseCard(card: string): AiJobsCard {
  const anchor =
    /<a\b[^>]*class="[^"]*stretched-link[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(
      card,
    );
  const href = /href="(\/job\/[^"]+)"/.exec(anchor?.[0] ?? "")?.[1];
  const title = clean(anchor?.[1] ?? "").replace(
    /^\s*(Featured|Feat\.)\s*/i,
    "",
  );

  const spans = [...card.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)]
    .map((m) => clean(m[1]))
    .filter(Boolean);

  const salary = spans.find(
    (s) => s.includes("K") && /\$|€|£/.test(s) && s.length < 40,
  );
  const level = spans.find((s) =>
    /level|senior|junior|mid|executive|director/i.test(s),
  );
  const jobType = spans.find((s) =>
    /full-?time|part-?time|contract|freelance|internship/i.test(s),
  );
  const dateText = spans.find((s) => /\d+\s*(d|h|w|mo)\s*ago/i.test(s));
  const location = spans.find(
    (s) =>
      !/level|senior|junior|mid|executive|director|full-?time|part-?time|contract|freelance|internship|\d+\s*(d|h|w|mo)\s*ago/i.test(
        s,
      ) &&
      /remote|hybrid|onsite|united states|canada|india|uk|germany|berlin|london|new york|san francisco/i.test(
        s,
      ),
  );

  const skillsBlock = firstGroup(card, /<div>\s*(<span>[\s\S]*?)<\/div>/i);
  const skills = skillsBlock
    ? [...skillsBlock.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)]
        .map((m) => clean(m[1]))
        .filter((s) => s.length > 0 && s.length < 60)
    : [];

  return {
    title,
    jobUrl: href ? `${AIJOBS_ORIGIN}${href}` : undefined,
    salary: parseSalary(salary),
    skills,
    location,
    level,
    jobType,
    isRemote: /remote/i.test(card),
    dateText,
  };
}

function mapToJob(card: AiJobsCard): CreateJobInput | undefined {
  if (!card.jobUrl || !card.title) return undefined;
  return {
    source: "aijobs",
    title: card.title.replace(/^\s*(Featured|Feat\.)\s*/i, "").trim(),
    employer: "Unknown Employer",
    jobUrl: card.jobUrl,
    applicationLink: card.jobUrl,
    jobDescription: card.skills?.length ? card.skills.join(", ") : undefined,
    location: card.location ?? "Remote",
    salary: card.salary,
    jobType: card.jobType,
    isRemote: card.isRemote,
    datePosted: parseDate(card.dateText),
  };
}

export async function runAiJobs(
  options: RunAiJobsOptions = {},
): Promise<AiJobsResult> {
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
    onProgress?.({
      type: "term_start",
      termIndex: termIndex + 1,
      termTotal: searchTerms.length,
      searchTerm,
    });

    let termJobs = 0;
    let termError: string | undefined;

    try {
      for (let page = 1; page <= MAX_PAGES; page++) {
        if (shouldCancel?.()) break;
        if (termJobs >= maxJobsPerTerm) break;

        const url = `${AIJOBS_ORIGIN}/?q=${encodeURIComponent(searchTerm)}&page=${page}`;
        const response = await fetchImpl(url, {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "accept-language": "en-US,en;q=0.9",
            "user-agent": USER_AGENT,
          },
        });
        if (!response.ok) {
          termError = `ai-jobs.net returned HTTP ${response.status}`;
          break;
        }
        const body = await response.text();

        let pageJobs = 0;
        for (const rawCard of [...body.matchAll(CARD_RE)].map((m) => m[1])) {
          if (termJobs >= maxJobsPerTerm) break;
          const mapped = mapToJob(parseCard(rawCard));
          if (!mapped) continue;
          if (seen.has(mapped.jobUrl)) continue;
          seen.add(mapped.jobUrl);
          jobs.push(mapped);
          termJobs += 1;
          pageJobs += 1;
        }
        if (pageJobs === 0) break;
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
