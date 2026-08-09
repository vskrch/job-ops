import type { CreateJobInput } from "@shared/types/jobs";

const TALENT_ORIGIN = "https://www.talent.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const DEFAULT_MAX_JOBS = 50;
const MAX_PAGES = 5;
const CARD_RE =
  /<article class="[^"]*JobCard_card[^"]*"[^>]*data-testid="job-card-unified"[\s\S]*?<\/article>/g;

export interface TalentProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunTalentOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  onProgress?: (event: TalentProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface TalentResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

function clean(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstGroup(content: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(content);
  return match?.[1];
}

function extractJobCard(card: string): CreateJobInput | undefined {
  const anchor = /<a\b[^>]*href="([^"]+)"[^>]*>[\s\S]*?<\/a>/.exec(card);
  const jobUrl = anchor?.[1]
    ? new URL(anchor[1], TALENT_ORIGIN).toString()
    : undefined;

  const title = firstGroup(
    card,
    /class="[^"]*JobCard_title[^"]*"[^>]*>([\s\S]*?)<\//,
  );
  const company = firstGroup(
    card,
    /class="[^"]*JobCard_company[^"]*"[^>]*>([\s\S]*?)<\//,
  );
  const location = firstGroup(
    card,
    /class="[^"]*JobCard_location[^"]*"[^>]*>([\s\S]*?)<\//,
  );

  if (!title || !jobUrl) return undefined;

  const salaryMatch = card.match(
    /class="[^"]*JobCard_salary[^"]*"[^>]*>([\s\S]*?)<\//,
  );
  const salary = salaryMatch ? clean(salaryMatch[1]) : undefined;

  const isRemote = /remote/i.test(location ?? "");

  return {
    source: "talent",
    title: clean(title),
    employer: company ? clean(company) : "Unknown Employer",
    jobUrl,
    applicationLink: jobUrl,
    jobDescription: undefined,
    location: location ? clean(location) : undefined,
    salary: salary,
    isRemote,
  };
}

export async function runTalent(
  options: RunTalentOptions = {},
): Promise<TalentResult> {
  const {
    searchTerms = ["software engineer"],
    selectedCountry = "United States",
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

        const params = new URLSearchParams({
          k: searchTerm,
          l: selectedCountry,
        });
        if (page > 1) params.set("page", String(page));
        const url = `${TALENT_ORIGIN}/jobs?${params.toString()}`;

        const response = await fetchImpl(url, {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "accept-language": "en-US,en;q=0.9",
            "user-agent": USER_AGENT,
          },
        });
        if (!response.ok) {
          termError = `Talent.com returned HTTP ${response.status}`;
          break;
        }
        const body = await response.text();

        let pageJobs = 0;
        for (const rawCard of [...body.matchAll(CARD_RE)].map((m) => m[0])) {
          if (termJobs >= maxJobsPerTerm) break;
          const mapped = extractJobCard(rawCard);
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
