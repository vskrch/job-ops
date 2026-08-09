import type { CreateJobInput } from "@shared/types/jobs";

const CAREERBUILDER_ORIGIN = "https://www.careerbuilder.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface CareerBuilderProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunCareerBuilderOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  maxPagesPerTerm?: number;
  onProgress?: (event: CareerBuilderProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface CareerBuilderResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface CareerBuilderCard {
  title?: string;
  company?: string;
  locationRaw?: string;
  jobType?: string;
  description?: string;
  salary?: string;
  jobUrl?: string;
  sourceJobId?: string;
  employerUrl?: string;
  easyApply: boolean;
}

function clean(value: string): string {
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

function isBlockedResponse(status: number, body: string): string | undefined {
  if (status === 401 || status === 403 || status === 429) {
    return `CareerBuilder returned HTTP ${status} (anti-bot challenge).`;
  }
  if (
    /Please enable JS|captcha-delivery\.com|DataDome|__cf_chl|captcha\b/i.test(
      body,
    ) &&
    !/<li[^>]*data-results-content-parent/i.test(body)
  ) {
    return "CareerBuilder served a bot-protection challenge instead of job results.";
  }
  return undefined;
}

function extractCards(html: string): string[] {
  const cards: string[] = [];
  for (const match of html.matchAll(
    /<li\b[^>]*class=["'][^"']*data-results-content-parent[\s\S]*?<\/li>/g,
  )) {
    cards.push(match[0]);
  }
  return cards;
}

function firstGroup(content: string, pattern: RegExp): string | undefined {
  const match = pattern.exec(content);
  return match?.[1];
}

function parseLocation(raw: string): { location?: string; isRemote?: boolean } {
  const modeMatch = raw.match(/\(([^)]*)\)/);
  const mode = modeMatch?.[1]?.toLowerCase() ?? "";
  let location = raw
    .replace(/\([^)]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!location) location = "Remote";
  return {
    location,
    isRemote: mode.includes("remote"),
  };
}

function parseSalaryAmounts(salary: string): {
  salaryMinAmount?: number;
  salaryMaxAmount?: number;
  salaryCurrency?: string;
  salaryInterval?: string;
} {
  const amounts = [...salary.matchAll(/\$([\d,]+(?:\.\d+)?)/g)]
    .map((m) => Number.parseFloat(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const interval = /per\s*year|\/year|\/yr\b|a\s*year|annual/i.test(salary)
    ? "yearly"
    : /per\s*hour|\/hr\b|\/hour|an\s*hour/i.test(salary)
      ? "hourly"
      : undefined;
  return {
    salaryMinAmount: amounts[0],
    salaryMaxAmount:
      amounts.length > 1 ? amounts[amounts.length - 1] : undefined,
    salaryCurrency: "USD",
    salaryInterval: interval,
  };
}

function parseCard(card: string): CareerBuilderCard {
  const title = firstGroup(
    card,
    /class=["'][^"']*data-results-title[^"']*["'][^>]*>([\s\S]*?)<\/div>/,
  );
  const details = firstGroup(
    card,
    /class=["'][^"']*data-details[^"']*["'][^>]*>([\s\S]*?<\/div>)/,
  );
  const detailSpans = details
    ? [...details.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)]
        .map((m) => clean(m[1]))
        .filter(Boolean)
    : [];

  const blocks: string[] = [];
  let description: string | undefined;
  let salary: string | undefined;
  for (const m of card.matchAll(
    /class=["']block[^"']*["'][^>]*>([\s\S]*?)<\/div>/g,
  )) {
    const text = clean(m[1]);
    if (!text) continue;
    if (m[0].includes("show-mobile")) {
      if (!description) description = text;
      continue;
    }
    blocks.push(text);
  }
  for (const text of blocks) {
    if (
      !salary &&
      text.includes("$") &&
      /[\d,]/.test(text) &&
      text.length < 160
    ) {
      salary = text;
    }
  }

  const anchor = card.match(
    /<a\b[^>]*class=["'][^"']*data-results-content[^"']*["'][^>]*>/,
  )?.[0];
  const jobDid = anchor
    ? /\bdata-job-did="([^"]+)"/.exec(anchor)?.[1]
    : undefined;
  const href = anchor ? /href="([^"]+)"/.exec(anchor)?.[1] : undefined;
  const employerHref = card.match(/href="(\/jobs-at-[^"]+)"/)?.[1];

  const easyApply =
    /data-results-bubble/.test(card) && /Quick Apply|Easy Apply/i.test(card);

  return {
    title: title ? clean(title) : undefined,
    company: detailSpans[0],
    locationRaw: detailSpans[1],
    jobType: detailSpans[2],
    description,
    salary,
    jobUrl: href ? `${CAREERBUILDER_ORIGIN}${href}` : undefined,
    sourceJobId: jobDid,
    employerUrl: employerHref
      ? `${CAREERBUILDER_ORIGIN}${employerHref.split("#")[0]}`
      : undefined,
    easyApply,
  };
}

function mapToJob(card: CareerBuilderCard): CreateJobInput | undefined {
  if (!card.jobUrl || !card.title) return undefined;
  const locationInfo = parseLocation(card.locationRaw ?? "");
  const salaryInfo = parseSalaryAmounts(card.salary ?? "");
  return {
    source: "careerbuilder",
    title: card.title,
    employer: card.company ?? "Unknown Employer",
    employerUrl: card.employerUrl,
    jobUrl: card.jobUrl,
    applicationLink: card.easyApply ? card.jobUrl : undefined,
    jobDescription: card.description,
    location: locationInfo.location,
    salary: card.salary,
    jobType: card.jobType,
    isRemote: locationInfo.isRemote,
    sourceJobId: card.sourceJobId,
    ...salaryInfo,
  };
}

export async function runCareerBuilder(
  options: RunCareerBuilderOptions = {},
): Promise<CareerBuilderResult> {
  const {
    searchTerms = ["software engineer"],
    maxJobsPerTerm = 50,
    maxPagesPerTerm = 6,
    onProgress,
    shouldCancel,
    fetchImpl = fetch,
  } = options;

  const jobs: CreateJobInput[] = [];
  const seen = new Set<string>();
  const termErrors: string[] = [];

  for (let termIndex = 0; termIndex < searchTerms.length; termIndex++) {
    if (shouldCancel?.())
      return { success: jobs.length > 0, jobs, error: termErrors[0] };
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
      for (let page = 1; page <= maxPagesPerTerm; page++) {
        if (shouldCancel?.()) break;
        if (termJobs >= maxJobsPerTerm) break;

        const url = `${CAREERBUILDER_ORIGIN}/jobs?keywords=${encodeURIComponent(searchTerm)}&page_number=${page}`;
        const response = await fetchImpl(url, {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "accept-language": "en-US,en;q=0.9",
            "user-agent": USER_AGENT,
          },
        });
        const body = await response.text();

        const blocked = isBlockedResponse(response.status, body);
        if (blocked) {
          termError = blocked;
          break;
        }

        const cards = extractCards(body);
        if (cards.length === 0) break;

        let pageJobs = 0;
        for (const rawCard of cards) {
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
    return {
      success: false,
      jobs,
      error: termErrors.join("; "),
    };
  }
  if (termErrors.length > 0) {
    return { success: true, jobs, error: termErrors.join("; ") };
  }
  return { success: true, jobs };
}
