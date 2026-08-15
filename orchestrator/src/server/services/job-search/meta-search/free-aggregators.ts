/**
 * Free Public Job Aggregators Adapter (ADR-008).
 *
 * Discovers jobs from completely free, open public job APIs without requiring
 * any registration or API tokens:
 * 1. Jobicy Public API
 * 2. RemoteOK Public API
 * 3. Arbeitnow Public API
 */

import { logger } from "@infra/logger";
import type { CreateJobInput } from "@shared/types";
import type { MetaSearchAdapter, MetaSearchParams } from "./types";

interface JobicyResponse {
  jobs?: Array<{
    id: number;
    url: string;
    jobTitle: string;
    companyName: string;
    companyLogo?: string;
    jobIndustry?: string[];
    jobType?: string[];
    jobGeo?: string;
    jobLevel?: string;
    jobExcerpt?: string;
    jobDescription?: string;
    pubDate?: string;
    annualSalaryMin?: string;
    annualSalaryMax?: string;
    salaryCurrency?: string;
  }>;
}

interface RemoteOkJob {
  id?: string;
  epoch?: number;
  date?: string;
  company?: string;
  position?: string;
  tags?: string[];
  logo?: string;
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
  apply_url?: string;
}

interface ArbeitnowResponse {
  data?: Array<{
    slug: string;
    company_name: string;
    title: string;
    description: string;
    remote: boolean;
    url: string;
    tags?: string[];
    job_types?: string[];
    location?: string;
    created_at: number;
  }>;
}

export const freeAggregatorsAdapter: MetaSearchAdapter = {
  id: "free-public-aggregators",
  displayName: "Free Public Aggregators (Jobicy, RemoteOK, Arbeitnow)",

  async available(): Promise<boolean> {
    return true; // 100% free and open
  },

  async *search(params: MetaSearchParams): AsyncGenerator<CreateJobInput[]> {
    const term =
      params.terms.length > 0 ? params.terms[0].toLowerCase() : "engineer";
    const jobs: CreateJobInput[] = [];

    // 1. Query Jobicy
    try {
      const jobicyUrl = `https://jobicy.com/api/v2/remote-jobs?count=30&tag=${encodeURIComponent(term)}`;
      const resp = await fetch(jobicyUrl, {
        headers: { Accept: "application/json" },
      });
      if (resp.ok) {
        const data = (await resp.json()) as JobicyResponse;
        if (data.jobs && Array.isArray(data.jobs)) {
          for (const j of data.jobs) {
            jobs.push({
              title: j.jobTitle,
              employer: j.companyName,
              jobUrl: j.url,
              location: j.jobGeo || "Remote",
              source: "jobicy" as CreateJobInput["source"],
              sourceJobId: String(j.id),
              jobDescription: j.jobExcerpt || j.jobDescription,
              jobType: j.jobType?.[0]?.toLowerCase() || "fulltime",
              isRemote: true,
              companyLogo: j.companyLogo,
              salary: j.annualSalaryMin
                ? `${j.salaryCurrency || "$"} ${j.annualSalaryMin} - ${j.annualSalaryMax || ""}`
                : undefined,
              applicationLink: j.url,
            });
          }
        }
      }
    } catch (e) {
      logger.debug("Jobicy fetch failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // 2. Query RemoteOK
    try {
      const remoteOkUrl = `https://remoteok.com/api?tag=${encodeURIComponent(term)}`;
      const resp = await fetch(remoteOkUrl, {
        headers: {
          "User-Agent": "JobOpsJobFinder/1.0",
          Accept: "application/json",
        },
      });
      if (resp.ok) {
        const data = (await resp.json()) as RemoteOkJob[];
        if (Array.isArray(data)) {
          for (const j of data) {
            if (!j.position || !j.company || !j.url) continue;
            jobs.push({
              title: j.position,
              employer: j.company,
              jobUrl: j.url.startsWith("http")
                ? j.url
                : `https://remoteok.com${j.url}`,
              location: j.location || "Remote",
              source: "remoteok" as CreateJobInput["source"],
              sourceJobId: j.id,
              jobDescription: j.description
                ? j.description.slice(0, 2000)
                : undefined,
              isRemote: true,
              companyLogo: j.logo,
              salary: j.salary_min
                ? `$${j.salary_min} - $${j.salary_max || ""}`
                : undefined,
              applicationLink: j.apply_url || j.url,
            });
          }
        }
      }
    } catch (e) {
      logger.debug("RemoteOK fetch failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    // 3. Query Arbeitnow
    try {
      const arbeitnowUrl = "https://www.arbeitnow.com/api/job-board-api";
      const resp = await fetch(arbeitnowUrl, {
        headers: { Accept: "application/json" },
      });
      if (resp.ok) {
        const data = (await resp.json()) as ArbeitnowResponse;
        if (data.data && Array.isArray(data.data)) {
          for (const j of data.data) {
            const titleLower = j.title.toLowerCase();
            const descLower = j.description.toLowerCase();
            if (
              !params.terms.some(
                (t) =>
                  titleLower.includes(t.toLowerCase()) ||
                  descLower.includes(t.toLowerCase()),
              )
            ) {
              continue;
            }
            jobs.push({
              title: j.title,
              employer: j.company_name,
              jobUrl: j.url,
              location: j.location || (j.remote ? "Remote" : "Global"),
              source: "arbeitnow" as CreateJobInput["source"],
              sourceJobId: j.slug,
              jobDescription: j.description
                .replace(/<[^>]+>/g, " ")
                .slice(0, 2000),
              isRemote: j.remote,
              applicationLink: j.url,
            });
          }
        }
      }
    } catch (e) {
      logger.debug("Arbeitnow fetch failed", {
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if (jobs.length > 0) {
      yield jobs;
    }
  },
};
