import type { CreateJobInput } from "@shared/types/jobs";

const WORKOPOLIS_ORIGIN = "https://www.workopolis.com";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export interface WorkopolisProgressEvent {
  type: "term_start" | "term_complete";
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}

export interface RunWorkopolisOptions {
  searchTerms?: string[];
  selectedCountry?: string;
  maxJobsPerTerm?: number;
  maxPagesPerTerm?: number;
  onProgress?: (event: WorkopolisProgressEvent) => void;
  shouldCancel?: () => boolean;
  fetchImpl?: typeof fetch;
}

export interface WorkopolisResult {
  success: boolean;
  jobs: CreateJobInput[];
  error?: string;
}

interface WorkopolisRawJob {
  jobKey?: unknown;
  title?: unknown;
  snippet?: unknown;
  company?: unknown;
  location?: unknown;
  salaryInfo?: unknown;
  botUrl?: unknown;
  encodedUrl?: unknown;
  dateOnIndeed?: unknown;
  jobTypes?: unknown;
  remoteAttributes?: unknown;
  companyRating?: unknown;
}

interface WorkopolisPage {
  jobs?: WorkopolisRawJob[];
  currentPageNumber?: unknown;
  pageCursors?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPageData(payload: unknown): WorkopolisPage | undefined {
  if (!isRecord(payload)) return undefined;
  const props = payload.props;
  if (!isRecord(props)) return undefined;
  const pageProps = props.pageProps;
  if (!isRecord(pageProps)) return undefined;
  const rawJobs = pageProps.jobs;
  if (!Array.isArray(rawJobs)) return undefined;
  const jobs = rawJobs.filter(isRecord) as WorkopolisRawJob[];
  const pageCursors: Record<string, unknown> = {};
  if (isRecord(pageProps.pageCursors)) {
    for (const [key, value] of Object.entries(pageProps.pageCursors)) {
      if (typeof value === "string") pageCursors[key] = value;
    }
  }
  return {
    jobs,
    currentPageNumber: pageProps.currentPageNumber,
    pageCursors,
  };
}

function extractNextData(html: string): unknown {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
  );
  if (!match) return undefined;
  try {
    return JSON.parse(match[1]) as unknown;
  } catch {
    return undefined;
  }
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parseSalaryInfo(salaryInfo: string | undefined): {
  salary?: string;
  salaryMinAmount?: number;
  salaryMaxAmount?: number;
  salaryCurrency?: string;
  salaryInterval?: string;
} {
  if (!salaryInfo) return {};
  const amounts = [...salaryInfo.matchAll(/\$([\d,]+(?:\.\d+)?)/g)]
    .map((m) => Number.parseFloat(m[1].replace(/,/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  const interval = /an?\s*hour|per\s*hour|\/hr\b|\/hour/i.test(salaryInfo)
    ? "hourly"
    : /a\s*year|per\s*year|annual|\/yr\b/i.test(salaryInfo)
      ? "yearly"
      : undefined;
  return {
    salary: salaryInfo,
    salaryMinAmount: amounts[0],
    salaryMaxAmount:
      amounts.length > 1 ? amounts[amounts.length - 1] : undefined,
    salaryCurrency: "CAD",
    salaryInterval: interval,
  };
}

function mapJob(raw: WorkopolisRawJob): CreateJobInput | undefined {
  const title = stringValue(raw.title);
  const botUrl = stringValue(raw.botUrl);
  if (!title || !botUrl) return undefined;

  const jobUrl = `${WORKOPOLIS_ORIGIN}${botUrl}`;
  const encodedUrl = stringValue(raw.encodedUrl);
  const applicationLink = encodedUrl
    ? `${WORKOPOLIS_ORIGIN}${decodeURIComponent(encodedUrl)}`
    : undefined;

  const jobTypes = Array.isArray(raw.jobTypes)
    ? raw.jobTypes.filter((value): value is string => typeof value === "string")
    : [];
  const remoteAttributes = Array.isArray(raw.remoteAttributes)
    ? raw.remoteAttributes.filter(
        (value): value is string => typeof value === "string",
      )
    : [];

  const dateMs =
    typeof raw.dateOnIndeed === "number" ? raw.dateOnIndeed : undefined;

  const salaryInfo = parseSalaryInfo(stringValue(raw.salaryInfo));

  return {
    source: "workopolis",
    title,
    employer: stringValue(raw.company) ?? "Unknown Employer",
    jobUrl,
    applicationLink,
    jobDescription: clean(stringValue(raw.snippet) ?? ""),
    location: stringValue(raw.location),
    datePosted: dateMs ? new Date(dateMs).toISOString() : undefined,
    jobType: jobTypes.join(", ") || undefined,
    salarySource: "workopolis",
    isRemote: remoteAttributes.some((attr) =>
      attr.toLowerCase().includes("remote"),
    ),
    sourceJobId: stringValue(raw.jobKey),
    companyRating:
      typeof raw.companyRating === "number" ? raw.companyRating : undefined,
    ...salaryInfo,
  };
}

export async function runWorkopolis(
  options: RunWorkopolisOptions = {},
): Promise<WorkopolisResult> {
  const {
    searchTerms = ["software engineer"],
    maxJobsPerTerm = 50,
    maxPagesPerTerm = 10,
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
      const searchUrl = `${WORKOPOLIS_ORIGIN}/jobs?q=${encodeURIComponent(searchTerm)}`;
      const firstResponse = await fetchImpl(searchUrl, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
          "user-agent": USER_AGENT,
        },
      });
      if (!firstResponse.ok) {
        throw new Error(`Workopolis returned HTTP ${firstResponse.status}`);
      }
      const firstHtml = await firstResponse.text();
      const firstPage = extractNextData(firstHtml);
      const pageData = readPageData(firstPage);
      if (!pageData) {
        throw new Error(
          "Workopolis page did not contain job data (__NEXT_DATA__).",
        );
      }

      let currentPage: WorkopolisPage | undefined = pageData;
      const processedKeys = new Set<string>();
      let pageNumber = 1;

      while (currentPage && pageNumber <= maxPagesPerTerm) {
        if (shouldCancel?.()) break;
        if (termJobs >= maxJobsPerTerm) break;

        for (const raw of currentPage.jobs ?? []) {
          if (termJobs >= maxJobsPerTerm) break;
          const mapped = mapJob(raw);
          if (!mapped) continue;
          const dedupeKey = mapped.jobUrl;
          if (processedKeys.has(dedupeKey)) continue;
          processedKeys.add(dedupeKey);
          if (!seen.has(dedupeKey)) {
            seen.add(dedupeKey);
            jobs.push(mapped);
          }
          termJobs += 1;
        }

        const cursors = currentPage.pageCursors ?? {};
        const nextCursor = cursors[String(pageNumber + 1)];
        if (typeof nextCursor !== "string") break;

        const nextUrl = `${WORKOPOLIS_ORIGIN}/jobs?q=${encodeURIComponent(searchTerm)}&cursor=${encodeURIComponent(nextCursor)}`;
        const nextResponse = await fetchImpl(nextUrl, {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "accept-language": "en-US,en;q=0.9",
            "user-agent": USER_AGENT,
          },
        });
        if (!nextResponse.ok) break;
        const nextHtml = await nextResponse.text();
        const nextPage = readPageData(extractNextData(nextHtml));
        currentPage = nextPage;
        pageNumber += 1;
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
