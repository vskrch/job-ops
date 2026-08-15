/**
 * SerpAPI Google Jobs adapter (ADR-008 SE-002).
 *
 * Queries the SerpAPI Google Jobs engine for structured job results.
 * Paginated via `start` parameter (0, 10, 20, …). Each page yields
 * up to 10 job results mapped to CreateJobInput.
 *
 * Gated by SERPAPI_KEY env var or `serpApiKey` setting.
 */

import { logger } from "@infra/logger";
import * as settingsRepo from "@server/repositories/settings";
import type { CreateJobInput } from "@shared/types";
import type { MetaSearchAdapter, MetaSearchParams } from "./types";

const SERPAPI_BASE = "https://serpapi.com/search.json";

async function getSerpApiKey(): Promise<string | null> {
  const envKey = process.env.SERPAPI_KEY?.trim();
  if (envKey) return envKey;
  try {
    const setting = await settingsRepo.getSetting("serpApiKey");
    return setting?.trim() || null;
  } catch {
    return null;
  }
}

function buildLocationQuery(params: MetaSearchParams): string {
  const parts: string[] = [];
  if (params.location.cities.length > 0) {
    parts.push(params.location.cities[0]);
  }
  if (params.location.country) {
    parts.push(params.location.country);
  }
  return parts.join(", ");
}

function mapSerpJobToCreateJobInput(
  serpJob: Record<string, unknown>,
): CreateJobInput | null {
  const title = serpJob.title as string | undefined;
  const companyName = serpJob.company_name as string | undefined;
  const location = serpJob.location as string | undefined;
  const jobId = serpJob.job_id as string | undefined;

  if (!title || !companyName) return null;

  const extensions = serpJob.extensions as string[] | undefined;
  const detectedExtensions = serpJob.detected_extensions as
    | Record<string, unknown>
    | undefined;

  let jobUrl =
    (serpJob.share_link as string | undefined) ??
    (serpJob.apply_link as string | undefined) ??
    "";
  if (!jobUrl && (serpJob.related_links as unknown[])?.length) {
    const links = serpJob.related_links as Array<{ link?: string }>;
    jobUrl = links[0]?.link ?? "";
  }
  // If still no URL, construct a Google Jobs URL from the job ID.
  if (!jobUrl && jobId) {
    jobUrl = `https://www.google.com/search?q=${encodeURIComponent(title)}+${encodeURIComponent(companyName)}&ibp=htl;jobs#htivrt=jobs&htidocid=${encodeURIComponent(jobId)}`;
  }
  if (!jobUrl) return null;

  const description = serpJob.description as string | undefined;
  const thumbnail = serpJob.thumbnail as string | undefined;

  // Parse schedule/work type from extensions.
  let jobType: string | undefined;
  let isRemote: boolean | undefined;
  let salary: string | undefined;

  if (extensions) {
    for (const ext of extensions) {
      const lower = ext.toLowerCase();
      if (lower.includes("full-time") || lower.includes("full time"))
        jobType = "fulltime";
      else if (lower.includes("part-time") || lower.includes("part time"))
        jobType = "parttime";
      else if (lower.includes("contract")) jobType = "contract";
      else if (lower.includes("intern")) jobType = "internship";
      if (lower.includes("remote") || lower.includes("work from home"))
        isRemote = true;
    }
  }

  if (detectedExtensions) {
    const salaryStr = detectedExtensions.salary as string | undefined;
    if (salaryStr) salary = salaryStr;
  }

  const via = serpJob.via as string | undefined;
  const datePosted =
    (serpJob.detected_extensions as Record<string, string> | undefined)
      ?.posted_at ?? undefined;

  return {
    title,
    employer: companyName,
    jobUrl,
    location: location ?? "",
    source: "google" as CreateJobInput["source"],
    sourceJobId: jobId ?? undefined,
    jobDescription: description,
    salary,
    jobType,
    isRemote,
    datePosted,
    companyLogo: thumbnail,
    applicationLink: (
      serpJob.apply_options as Array<{ link?: string }> | undefined
    )?.[0]?.link,
    companyDescription: via ? `via ${via}` : undefined,
  };
}

export const serpApiAdapter: MetaSearchAdapter = {
  id: "serpapi-google-jobs",
  displayName: "Google Jobs (SerpAPI)",

  async available(): Promise<boolean> {
    const key = await getSerpApiKey();
    return Boolean(key);
  },

  async *search(params: MetaSearchParams): AsyncGenerator<CreateJobInput[]> {
    const apiKey = await getSerpApiKey();
    if (!apiKey) return;

    const queryParts = [...params.terms];
    const locationQ = buildLocationQuery(params);

    const baseQuery = queryParts.join(" ");
    const searchQuery =
      params.workMode === "remote"
        ? `${baseQuery} remote`
        : params.workMode === "hybrid"
          ? `${baseQuery} hybrid`
          : baseQuery;

    const maxPages = Math.min(params.maxPages, 10);

    for (let page = 0; page < maxPages; page++) {
      const start = page * 10;
      const url = new URL(SERPAPI_BASE);
      url.searchParams.set("engine", "google_jobs");
      url.searchParams.set("q", searchQuery);
      url.searchParams.set("api_key", apiKey);
      url.searchParams.set("start", String(start));

      if (locationQ) {
        url.searchParams.set("location", locationQ);
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), params.timeoutMs);

        const response = await fetch(url.toString(), {
          signal: controller.signal,
        });
        clearTimeout(timeout);

        if (!response.ok) {
          logger.warn("SerpAPI request failed", {
            status: response.status,
            page,
          });
          return;
        }

        const data = (await response.json()) as {
          jobs_results?: Array<Record<string, unknown>>;
          error?: string;
        };

        if (data.error) {
          logger.warn("SerpAPI returned error", { error: data.error });
          return;
        }

        const serpJobs = data.jobs_results;
        if (!serpJobs || serpJobs.length === 0) {
          // No more results — stop paginating.
          return;
        }

        const jobs: CreateJobInput[] = [];
        for (const serpJob of serpJobs) {
          const mapped = mapSerpJobToCreateJobInput(serpJob);
          if (mapped) jobs.push(mapped);
        }

        if (jobs.length > 0) {
          yield jobs;
        }

        // If fewer than 10 results, we've exhausted the listing.
        if (serpJobs.length < 10) return;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        logger.warn("SerpAPI page fetch failed", {
          page,
          error: message,
        });
        return;
      }
    }
  },
};
