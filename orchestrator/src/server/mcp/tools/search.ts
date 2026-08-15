/**
 * MCP Search Tools (ADR-008).
 *
 * Exposes search_jobs, get_search_status, and list_recent_searches to external agentic CLIs.
 */

import { logger } from "@infra/logger";
import * as jobSearchRepo from "@server/repositories/job-search";
import {
  computeAdmissionHash,
  createSearchRecord,
  executeJobSearch,
  findReusableSearch,
  getRunningSearchByAdmissionHash,
  JOB_SEARCH_PARSER_VERSION,
  SOURCE_PLAN_VERSION,
} from "@server/services/job-search";
import type { McpTool, McpToolHandler } from "../types";

export const searchJobsTool: McpTool = {
  name: "search_jobs",
  description:
    "Execute an internet-wide job search using natural language criteria (e.g. 'Senior React engineer in London, hybrid or remote, 100k+'). Returns structured results, match grades, and source information.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "Natural language query describing the desired roles, locations, skills, and constraints.",
      },
      fresh: {
        type: "boolean",
        description:
          "If true, bypasses existing cached searches and performs a fresh internet-wide crawl.",
      },
    },
    required: ["query"],
  },
};

export const handleSearchJobs: McpToolHandler = async (args) => {
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) {
    return {
      content: [{ type: "text", text: "Error: query parameter is required." }],
      isError: true,
    };
  }

  const fresh = Boolean(args.fresh);
  const admissionHash = computeAdmissionHash(query);

  try {
    let searchId: string;
    const cached = false;

    const running = await getRunningSearchByAdmissionHash(admissionHash);
    if (running) {
      searchId = running.id;
    } else {
      if (!fresh) {
        const reusable = await findReusableSearch(admissionHash, 3600_000);
        if (reusable) {
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  {
                    status: "completed",
                    searchId: reusable.id,
                    cached: true,
                    resultsCount: reusable.results?.jobs.length ?? 0,
                    results: reusable.results,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
      }

      const created = await createSearchRecord({
        originalQuery: query,
        admissionHash,
        parserVersion: JOB_SEARCH_PARSER_VERSION,
        sourcePlanVersion: SOURCE_PLAN_VERSION,
      });

      if (!created) {
        return {
          content: [
            {
              type: "text",
              text: "Search already in progress or duplicate query.",
            },
          ],
          isError: true,
        };
      }

      searchId = created.id;
      // Start background search execution
      void executeJobSearch(searchId, query).catch((err) => {
        logger.error("MCP job search background task failed", {
          searchId,
          error: err,
        });
      });
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              message:
                "Search started. Use `get_search_status` with this searchId to retrieve results.",
              searchId,
              query,
              cached,
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
      content: [{ type: "text", text: `Search failed to initialize: ${msg}` }],
      isError: true,
    };
  }
};

export const getSearchStatusTool: McpTool = {
  name: "get_search_status",
  description:
    "Check the status and retrieve results of a running or completed job search by search ID.",
  inputSchema: {
    type: "object",
    properties: {
      searchId: {
        type: "string",
        description: "The ID of the search returned by `search_jobs`.",
      },
    },
    required: ["searchId"],
  },
};

export const handleGetSearchStatus: McpToolHandler = async (args) => {
  const searchId =
    typeof args.searchId === "string" ? args.searchId.trim() : "";
  if (!searchId) {
    return {
      content: [
        { type: "text", text: "Error: searchId parameter is required." },
      ],
      isError: true,
    };
  }

  const record = await jobSearchRepo.getJobSearch(searchId);
  if (!record) {
    return {
      content: [
        { type: "text", text: `Search with ID '${searchId}' not found.` },
      ],
      isError: true,
    };
  }

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            id: record.id,
            status: record.status,
            phase: record.phase,
            originalQuery: record.originalQuery,
            parsedSpec: record.parsedSpec,
            sourcesSearched: record.sourcesSearched,
            results: record.results,
            evaluationTime: record.evaluationTime,
            searchStartedAt: record.searchStartedAt,
            searchCompletedAt: record.searchCompletedAt,
            errorMessage: record.errorMessage,
          },
          null,
          2,
        ),
      },
    ],
  };
};

export const listRecentSearchesTool: McpTool = {
  name: "list_recent_searches",
  description: "List recent job search queries and their completion status.",
  inputSchema: {
    type: "object",
    properties: {
      limit: {
        type: "number",
        description:
          "Maximum number of recent searches to return (default 10).",
      },
    },
  },
};

export const handleListRecentSearches: McpToolHandler = async (args) => {
  const limit =
    typeof args.limit === "number" ? Math.max(1, Math.min(50, args.limit)) : 10;
  const recent = await jobSearchRepo.getRecentJobSearches(limit);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          recent.map((s) => ({
            id: s.id,
            query: s.originalQuery,
            status: s.status,
            phase: s.phase,
            totalDiscovered: s.totalDiscovered,
            totalAfterFilter: s.totalAfterFilter,
            createdAt: s.createdAt,
          })),
          null,
          2,
        ),
      },
    ],
  };
};
