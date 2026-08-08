/**
 * LLM-powered job extraction for the crawl engine.
 *
 * Two modes, both strictly fallback-friendly:
 *
 * - `llmParseJobs`: extract structured jobs (title, employer, location,
 *   salary, jobType, description, urls) from a fetched list page. Used to
 *   recover jobs the regex parsers miss and to fill descriptions.
 * - `llmExtractDescription`: pull the description out of a job detail page.
 *
 * Lights-on contract: any failure (no LLM configured, provider down, bad
 * JSON) returns `null`/`{ success:false }` and callers keep their regex
 * results. Costs are capped with `JOBBOARDS_LLM_MAX_CHARS` (list text)
 * and `JOBBOARDS_LLM_DETAIL_PAGES` (detail fetches per term).
 */

import type { ExtractorSourceId } from "../extractors";
import type { CreateJobInput } from "../types/jobs";
import { chatJson, type LlmClientConfig } from "./chat.js";

const DEFAULT_MAX_CHARS = 14_000;
const DEFAULT_DETAIL_PAGES = 3;

/**
 * LLM path active when a base URL is explicitly provided via config or env
 * (the app UI's LLM settings map to `config`, env stays the fallback).
 */
export function llmJobsConfigured(config?: LlmClientConfig): boolean {
  if (process.env.JOBBOARDS_LLM_ENABLED === "0") return false;
  return Boolean(config?.baseUrl?.trim() || process.env.LLM_BASE_URL?.trim());
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n...[truncated]`;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeJobRecord(
  record: unknown,
  source: ExtractorSourceId,
): CreateJobInput | null {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }
  const raw = record as Record<string, unknown>;
  const title = toOptionalString(raw.title);
  if (!title) return null;

  const jobUrl =
    toOptionalString(raw.jobUrl) ??
    toOptionalString(raw.url) ??
    toOptionalString(raw.applicationLink);
  if (!jobUrl) return null;

  const employer =
    toOptionalString(raw.employer) ??
    toOptionalString(raw.company) ??
    "Unknown Employer";
  const sourceJobId =
    toOptionalString(raw.sourceJobId) ?? toOptionalString(raw.id) ?? undefined;
  const description = toOptionalString(raw.jobDescription);

  return {
    source,
    sourceJobId,
    title,
    employer,
    jobUrl,
    applicationLink: jobUrl,
    location: toOptionalString(raw.location),
    salary: toOptionalString(raw.salary),
    datePosted: toOptionalString(raw.datePosted),
    jobType: toOptionalString(raw.jobType),
    jobDescription: description ? truncate(description, 4_000) : undefined,
  };
}

function buildParsePrompt(
  source: string,
  searchTerm: string,
  pageText: string,
): Array<{ role: "user" | "system"; content: string }> {
  return [
    {
      role: "system",
      content:
        "You extract job listings from web page content. Return a JSON object " +
        'with a "jobs" array. Each job has: title, employer, location, salary, ' +
        "jobType, datePosted, jobUrl, sourceJobId, jobDescription. Only include " +
        "real job postings; skip navigation, ads, and boilerplate. jobUrl must be " +
        "an absolute URL. jobDescription is the posting's description text, at most " +
        "2000 characters. Respond with valid JSON only, no markdown.",
    },
    {
      role: "user",
      content: `Job board: ${source}\nSearch term: ${searchTerm}\n\nPage content:\n${pageText}`,
    },
  ];
}

/**
 * Parse a fetched list page into jobs. Returns null when the LLM is not
 * configured or every attempt fails.
 */
export async function llmParseJobs(args: {
  source: ExtractorSourceId;
  searchTerm: string;
  pageText: string;
  maxJobs?: number;
  signal?: AbortSignal;
  /** UI/settings-provided config; falls back to env vars. */
  llm?: LlmClientConfig;
}): Promise<CreateJobInput[] | null> {
  if (!llmJobsConfigured(args.llm)) return null;

  const pageText = truncate(
    args.pageText,
    envInt("JOBBOARDS_LLM_MAX_CHARS", DEFAULT_MAX_CHARS),
  );
  const result = await chatJson<unknown>({
    messages: buildParsePrompt(args.source, args.searchTerm, pageText),
    jsonMode: true,
    maxRetries: 2,
    llm: args.llm,
    signal: args.signal,
  });
  if (!result.success) return null;

  const records = Array.isArray(result.data)
    ? result.data
    : (result.data as { jobs?: unknown } | undefined)?.jobs;
  if (!Array.isArray(records)) return null;

  const maxJobs = Math.max(1, args.maxJobs ?? 100);
  const jobs: CreateJobInput[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (jobs.length >= maxJobs) break;
    const job = normalizeJobRecord(record, args.source);
    if (!job) continue;
    const key = job.sourceJobId || job.jobUrl;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push(job);
  }
  return jobs;
}

export interface DescriptionResult {
  success: boolean;
  description?: string;
  error?: string;
}

/**
 * Extract a description from a job detail page. Returns success:false on
 * any failure so callers keep their fallback.
 */
export async function llmExtractDescription(args: {
  jobUrl: string;
  title: string;
  employer: string;
  pageText: string;
  signal?: AbortSignal;
  /** UI/settings-provided config; falls back to env vars. */
  llm?: LlmClientConfig;
}): Promise<DescriptionResult> {
  const pageText = truncate(
    args.pageText,
    envInt("JOBBOARDS_LLM_MAX_CHARS", DEFAULT_MAX_CHARS),
  );
  const result = await chatJson<unknown>({
    messages: [
      {
        role: "system",
        content:
          "Extract the job description from this job posting page. Return a " +
          'JSON object {"description": "..."} with the full description as ' +
          "plain text, at most 4000 characters. Respond with valid JSON only.",
      },
      {
        role: "user",
        content: `Job: ${args.title} at ${args.employer}\nURL: ${args.jobUrl}\n\nPage content:\n${pageText}`,
      },
    ],
    jsonMode: true,
    maxRetries: 1,
    signal: args.signal,
    llm: args.llm,
  });
  if (!result.success) {
    return { success: false, error: result.error };
  }
  const description = toOptionalString(
    (result.data as { description?: unknown } | null)?.description,
  );
  if (!description) {
    return { success: false, error: "LLM returned no description" };
  }
  return { success: true, description };
}

export function llmDetailPagesLimit(): number {
  return envInt("JOBBOARDS_LLM_DETAIL_PAGES", DEFAULT_DETAIL_PAGES);
}
