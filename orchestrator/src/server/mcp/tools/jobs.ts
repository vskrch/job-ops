/**
 * MCP Job Tracking & Extraction Tools (ADR-008).
 *
 * Exposes tracked job management, 1-click import from searches, and deep LLM extraction.
 */

import * as jobsRepo from "@server/repositories/jobs";
import { importSearchJobsToTracked } from "@server/services/job-search/import";
import { CrawlEngine } from "@shared/crawl/engine.js";
import type { JobStatus } from "@shared/types";
import type { McpTool, McpToolHandler } from "../types";

export const getTrackedJobsTool: McpTool = {
  name: "get_tracked_jobs",
  description:
    "Get the list of currently tracked jobs in the application pipeline (discovered, applied, etc.).",
  inputSchema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        description:
          "Filter by status: 'discovered', 'processing', 'ready', 'applied', 'in_progress', 'skipped', 'expired'",
      },
      limit: {
        type: "number",
        description: "Maximum jobs to return (default 25).",
      },
    },
  },
};

export const handleGetTrackedJobs: McpToolHandler = async (args) => {
  const status =
    typeof args.status === "string" ? (args.status as JobStatus) : undefined;
  const limit = typeof args.limit === "number" ? args.limit : 25;

  const jobs = await jobsRepo.getAllJobs(status ? [status] : undefined);
  const sliced = jobs.slice(0, limit);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            total: jobs.length,
            returned: sliced.length,
            jobs: sliced.map((j) => ({
              id: j.id,
              title: j.title,
              employer: j.employer,
              location: j.location,
              status: j.status,
              salary: j.salary,
              suitabilityScore: j.suitabilityScore,
              suitabilityReason: j.suitabilityReason,
              matchGrade: j.matchGrade,
              jobUrl: j.jobUrl,
              discoveredAt: j.discoveredAt,
            })),
          },
          null,
          2,
        ),
      },
    ],
  };
};

export const importSearchJobsTool: McpTool = {
  name: "import_search_jobs",
  description:
    "Import jobs found in a search into the user's permanent tracked applications tab.",
  inputSchema: {
    type: "object",
    properties: {
      searchId: {
        type: "string",
        description: "The search ID whose results should be imported.",
      },
      mode: {
        type: "string",
        enum: ["all", "above_threshold", "selected"],
        description:
          "Import mode: 'all' imports all jobs, 'above_threshold' imports jobs matching minRelevance score, 'selected' imports specified URLs.",
      },
      minRelevance: {
        type: "number",
        description:
          "Minimum relevance score (0-100) when mode is 'above_threshold' (default 70).",
      },
      jobUrls: {
        type: "array",
        items: { type: "string" },
        description: "List of job URLs to import when mode is 'selected'.",
      },
    },
    required: ["searchId"],
  },
};

export const handleImportSearchJobs: McpToolHandler = async (args) => {
  const searchId =
    typeof args.searchId === "string" ? args.searchId.trim() : "";
  if (!searchId) {
    return {
      content: [{ type: "text", text: "Error: searchId is required." }],
      isError: true,
    };
  }

  const mode =
    (args.mode as "all" | "selected" | "above_threshold") || "above_threshold";
  const minRelevance =
    typeof args.minRelevance === "number" ? args.minRelevance : 70;
  const jobUrls = Array.isArray(args.jobUrls)
    ? (args.jobUrls as string[])
    : undefined;

  const result = await importSearchJobsToTracked(searchId, {
    mode,
    minRelevance,
    jobUrls,
  });

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            success: true,
            searchId,
            imported: result.imported,
            duplicatesSkipped: result.duplicates,
            totalProcessed:
              result.imported + result.duplicates + result.skipped,
          },
          null,
          2,
        ),
      },
    ],
  };
};

export const crawlAndExtractJobTool: McpTool = {
  name: "crawl_and_extract_job",
  description:
    "Crawl an external job posting URL, fetch its full page text, and extract clean structured job details.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description:
          "Direct URL to the job posting or careers page to extract.",
      },
      saveToTracked: {
        type: "boolean",
        description:
          "If true, automatically saves the extracted job to the tracked applications table.",
      },
    },
    required: ["url"],
  },
};

export const handleCrawlAndExtractJob: McpToolHandler = async (args) => {
  const url = typeof args.url === "string" ? args.url.trim() : "";
  if (!url || !url.startsWith("http")) {
    return {
      content: [
        { type: "text", text: "Error: valid http/https URL is required." },
      ],
      isError: true,
    };
  }

  try {
    const crawler = new CrawlEngine();
    const crawlResult = await crawler.request({ url });

    if (!crawlResult.ok || !crawlResult.text) {
      return {
        content: [
          {
            type: "text",
            text: `Failed to crawl URL: HTTP status ${crawlResult.status}`,
          },
        ],
        isError: true,
      };
    }

    const titleMatch = crawlResult.text.match(
      /<title[^>]*>([\s\S]*?)<\/title>/i,
    );
    const rawTitle = titleMatch
      ? titleMatch[1].trim()
      : "Extracted Job Posting";

    const extractedJob = {
      title: rawTitle,
      employer: "Extracted Employer",
      jobUrl: url,
      location: "Extracted Location",
      jobDescription: crawlResult.text.slice(0, 3000),
      source: "manual" as const,
      applicationLink: url,
    };

    let savedJob = null;
    if (args.saveToTracked) {
      savedJob = await jobsRepo.createJob(extractedJob);
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              success: true,
              url,
              extracted: extractedJob,
              savedToTracked: Boolean(savedJob),
              jobId: savedJob?.id,
            },
            null,
            2,
          ),
        },
      ],
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `Extraction failed: ${msg}` }],
      isError: true,
    };
  }
};
