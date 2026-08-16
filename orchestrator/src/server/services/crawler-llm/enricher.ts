/**
 * LLM-powered crawling and information gathering service.
 *
 * Integrates LLM intelligence into the discovery and crawling pipeline:
 * 1. Synthesizes high-precision search terms from candidate profiles.
 * 2. Deeply extracts & enriches unstructured/truncated job postings by fetching
 *    underlying detail pages and using LLM structured extraction.
 * 3. Enforces negative keyword and domain relevance filtering.
 */

import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { getSetting } from "@server/repositories/settings";
import { asyncPool } from "@server/utils/async-pool";
import { CrawlEngine } from "@shared/crawl/engine.js";
import type { CreateJobInput } from "@shared/types/jobs";
import type { ResumeProfile } from "@shared/types/settings";
import type { JsonSchemaDefinition } from "../llm/types";
import { createLlmClient } from "../modelSelection";
import { getProfile } from "../profile";

const QUERY_SYNTHESIS_SCHEMA: JsonSchemaDefinition = {
  name: "crawl_query_synthesis",
  schema: {
    type: "object",
    properties: {
      searchTerms: {
        type: "array",
        items: { type: "string" },
        description:
          "3 to 6 high-precision job search query terms optimized for job boards and APIs.",
      },
      negativeKeywords: {
        type: "array",
        items: { type: "string" },
        description:
          "Keywords or roles that should be excluded (e.g. sales, intern, marketing, tutor).",
      },
    },
    required: ["searchTerms", "negativeKeywords"],
    additionalProperties: false,
  },
};

const JOB_DETAIL_ENRICHMENT_SCHEMA: JsonSchemaDefinition = {
  name: "job_detail_enrichment",
  schema: {
    type: "object",
    properties: {
      description: {
        type: "string",
        description:
          "Comprehensive role description, key responsibilities, and team context (plain text, max 3000 chars).",
      },
      salary: {
        type: ["string", "null"],
        description:
          "Discovered compensation/salary range with currency if stated, or null.",
      },
      jobType: {
        type: ["string", "null"],
        enum: ["full_time", "part_time", "contract", "internship", null],
        description: "Standardized employment type.",
      },
      location: {
        type: ["string", "null"],
        description: "Normalized job location (e.g. 'Ottawa, ON (Remote)').",
      },
      skills: {
        type: "array",
        items: { type: "string" },
        description: "Key programming languages, frameworks, and technologies.",
      },
      seniorityLevel: {
        type: ["string", "null"],
        enum: [
          "junior",
          "mid",
          "senior",
          "lead",
          "staff",
          "principal",
          "entry",
          null,
        ],
        description: "Inferred or stated seniority level.",
      },
      workArrangement: {
        type: ["string", "null"],
        enum: ["remote", "hybrid", "onsite", null],
        description: "Work arrangement.",
      },
      visaStatus: {
        type: ["string", "null"],
        enum: [
          "sponsorship_available",
          "no_sponsorship",
          "citizen_or_pr_only",
          "not_specified",
          null,
        ],
        description: "Visa sponsorship eligibility if mentioned.",
      },
    },
    required: ["description", "salary", "jobType", "location", "skills"],
    additionalProperties: false,
  },
};

export interface SynthesizedCrawlQueries {
  searchTerms: string[];
  negativeKeywords: string[];
}

export interface EnrichedJobDetail {
  description: string;
  salary: string | null;
  jobType: string | null;
  location: string | null;
  skills: string[];
  seniorityLevel?: string | null;
  workArrangement?: string | null;
  visaStatus?: string | null;
}

/**
 * Synthesizes high-precision search keywords and negative exclusion terms
 * using candidate profile context and base search terms.
 */
export async function synthesizeCrawlTermsWithLlm(args: {
  baseSearchTerms: string[];
  selectedCountry?: string;
  userProfile?: ResumeProfile | null;
  settings?: Record<string, string | undefined>;
  signal?: AbortSignal;
}): Promise<SynthesizedCrawlQueries> {
  const isEnabled = args.settings
    ? args.settings.llmCrawlingEnabled !== "0"
    : (await getSetting("llmCrawlingEnabled").catch(() => "1")) !== "0";
  if (!isEnabled) {
    return {
      searchTerms: args.baseSearchTerms,
      negativeKeywords: [],
    };
  }

  try {
    const profile = args.userProfile ?? (await getProfile().catch(() => null));
    const rawSkills =
      profile?.sections?.skills?.items ||
      (Array.isArray((profile as Record<string, unknown> | null)?.skills)
        ? ((profile as Record<string, unknown>).skills as Array<{
            name?: string;
            keywords?: string[];
          }>)
        : []);
    const candidateSkills =
      rawSkills
        .map((s) => s.name || s.keywords?.join(", "))
        .filter(Boolean)
        .join(", ") || "Software Development";
    const candidateTitle =
      profile?.basics?.label ||
      profile?.basics?.headline ||
      args.baseSearchTerms[0] ||
      "Software Engineer";

    const prompt = `Candidate Title: ${candidateTitle}
Target Skills: ${candidateSkills}
Country: ${args.selectedCountry || "Any"}
User Initial Search Terms: ${args.baseSearchTerms.join(", ")}

Generate 3-6 targeted job search queries and a list of negative exclusion keywords.`;

    const { llm: llmService, model } = await createLlmClient("default");

    const response = await llmService.callJson<{
      searchTerms: string[];
      negativeKeywords: string[];
    }>({
      model,
      messages: [
        {
          role: "system",
          content:
            "You are an expert technical talent recruiter. Generate precise, high-conversion job search query terms and negative keywords to exclude non-technical or irrelevant roles.",
        },
        { role: "user", content: prompt },
      ],
      jsonSchema: QUERY_SYNTHESIS_SCHEMA,
      signal: args.signal,
    });

    if (response.success && response.data) {
      const searchTerms =
        Array.isArray(response.data.searchTerms) &&
        response.data.searchTerms.length > 0
          ? response.data.searchTerms
          : args.baseSearchTerms;
      const negativeKeywords = Array.isArray(response.data.negativeKeywords)
        ? response.data.negativeKeywords
        : [];

      logger.info("Synthesized LLM crawl queries", {
        originalTerms: args.baseSearchTerms,
        synthesizedTerms: searchTerms,
        negativeCount: negativeKeywords.length,
      });

      return { searchTerms, negativeKeywords };
    }
  } catch (error) {
    logger.warn(
      "Failed to synthesize crawl queries via LLM, falling back to base terms",
      {
        error: sanitizeUnknown(error),
      },
    );
  }

  return {
    searchTerms: args.baseSearchTerms,
    negativeKeywords: [],
  };
}

/**
 * Enriches discovered jobs by fetching raw detail pages for truncated jobs
 * and using LLM to extract full descriptions, tech stack, and salary.
 */
export async function enrichDiscoveredJobsWithLlm(args: {
  jobs: CreateJobInput[];
  maxEnrich?: number;
  settings?: Record<string, string | undefined>;
  shouldCancel?: () => boolean;
}): Promise<CreateJobInput[]> {
  const isEnabled = args.settings
    ? args.settings.llmEnrichmentEnabled !== "0"
    : (await getSetting("llmEnrichmentEnabled").catch(() => "1")) !== "0";
  if (!isEnabled || args.jobs.length === 0) {
    return args.jobs;
  }

  const rawMax = args.settings
    ? (args.settings.llmMaxEnrichmentJobs ?? "15")
    : await getSetting("llmMaxEnrichmentJobs").catch(() => "15");
  const maxEnrichSetting = Number.parseInt(rawMax || "15", 10);
  const maxEnrich =
    args.maxEnrich ??
    (Number.isFinite(maxEnrichSetting) ? maxEnrichSetting : 15);

  const engine = new CrawlEngine({
    behaviorProfile: "fast",
  });

  const { llm: llmService, model } = await createLlmClient("default");

  const jobsToEnrichIndices: number[] = [];
  for (let i = 0; i < args.jobs.length; i++) {
    const job = args.jobs[i];
    const needsEnrichment =
      !job.jobDescription || job.jobDescription.length < 250 || !job.salary;
    if (
      needsEnrichment &&
      job.jobUrl &&
      jobsToEnrichIndices.length < maxEnrich
    ) {
      jobsToEnrichIndices.push(i);
    }
  }

  if (jobsToEnrichIndices.length === 0) {
    return args.jobs;
  }

  const enrichedMap = new Map<number, CreateJobInput>();
  let enrichedCount = 0;

  await asyncPool({
    items: jobsToEnrichIndices,
    concurrency: 4,
    shouldStop: args.shouldCancel,
    task: async (idx) => {
      const job = args.jobs[idx];
      try {
        const crawlResult = await engine.request({
          url: job.jobUrl,
          backends: ["direct", "jina"],
          timeoutMs: 15_000,
          maxAttempts: 2,
        });

        if (
          !crawlResult.ok ||
          !crawlResult.text ||
          crawlResult.text.length < 100
        ) {
          return;
        }

        const pageSnippet = crawlResult.text.slice(0, 8000);
        const userPrompt = `Job Title: ${job.title}
Employer: ${job.employer}
URL: ${job.jobUrl}

Raw Page Content:
${pageSnippet}`;

        const response = await llmService.callJson<EnrichedJobDetail>({
          model,
          messages: [
            {
              role: "system",
              content:
                "You extract comprehensive job posting details from raw web pages. Output clear role responsibilities, compensation, tech stack, and location.",
            },
            { role: "user", content: userPrompt },
          ],
          jsonSchema: JOB_DETAIL_ENRICHMENT_SCHEMA,
        });

        if (response.success && response.data) {
          const enriched = response.data;
          enrichedCount += 1;

          const updatedJob: CreateJobInput = {
            ...job,
            jobDescription: enriched.description || job.jobDescription,
            salary: enriched.salary || job.salary,
            location: enriched.location || job.location,
            jobType: enriched.jobType || job.jobType,
            skills:
              Array.isArray(enriched.skills) && enriched.skills.length > 0
                ? enriched.skills.join(", ")
                : job.skills,
            jobLevel: enriched.seniorityLevel || job.jobLevel,
            isRemote:
              enriched.workArrangement === "remote" ? true : job.isRemote,
          };

          logger.debug("Enriched job with LLM details", {
            jobId: job.sourceJobId,
            title: job.title,
            hasSalary: Boolean(updatedJob.salary),
            descLength: updatedJob.jobDescription?.length ?? 0,
            skills: updatedJob.skills,
          });

          enrichedMap.set(idx, updatedJob);
        }
      } catch (error) {
        logger.warn("Failed to enrich job with LLM", {
          title: job.title,
          jobUrl: job.jobUrl,
          error: sanitizeUnknown(error),
        });
      }
    },
  });

  if (enrichedCount > 0) {
    logger.info("Completed LLM job enrichment pass", {
      totalJobs: args.jobs.length,
      enrichedCount,
    });
  }

  return args.jobs.map((job, idx) => enrichedMap.get(idx) ?? job);
}

/**
 * Fast relevance filter checking negative keywords and title mismatch.
 */
export function filterJobsByNegativeKeywords(
  jobs: CreateJobInput[],
  negativeKeywords: string[],
): CreateJobInput[] {
  if (negativeKeywords.length === 0) return jobs;
  const lowerNegatives = negativeKeywords
    .map((k) => k.toLowerCase().trim())
    .filter(Boolean);

  return jobs.filter((job) => {
    const titleLower = (job.title || "").toLowerCase();
    const isExcluded = lowerNegatives.some(
      (keyword) =>
        titleLower.includes(` ${keyword} `) ||
        titleLower.startsWith(`${keyword} `) ||
        titleLower.endsWith(` ${keyword}`) ||
        titleLower === keyword,
    );
    return !isExcluded;
  });
}
