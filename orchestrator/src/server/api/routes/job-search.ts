/**
 * API routes for job search & aggregation.
 *
 * POST   /api/job-search            — submit a NL search query
 * GET    /api/job-search            — list recent searches
 * GET    /api/job-search/:id        — get search results
 * GET    /api/job-search/:id/progress — SSE progress stream
 * POST   /api/job-search/:id/resend-email — re-send the results email
 */

import { AppError, badRequest, notFound } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { runWithRequestContext } from "@infra/request-context";
import { setupSse, startSseHeartbeat, writeSseData } from "@infra/sse";
import * as jobSearchRepo from "@server/repositories/job-search";
import * as settingsRepo from "@server/repositories/settings";
import { sendSearchResultsEmail } from "@server/services/email";
import {
  computeSearchHash,
  executeJobSearch,
  findCachedSearch,
  parseSearchQuery,
  subscribeToSearchProgress,
} from "@server/services/job-search";
import type { CreateJobSearchRequest } from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const jobSearchRouter = Router();

const createSearchSchema = z.object({
  query: z.string().min(1).max(2000),
  fresh: z.boolean().optional(),
});

/**
 * POST /api/job-search — Submit a new job search.
 */
jobSearchRouter.post("/", async (req: Request, res: Response) => {
  try {
    const input = createSearchSchema.parse(req.body) as CreateJobSearchRequest;
    const query = input.query.trim();

    if (!query) {
      return fail(res, badRequest("Query cannot be empty."));
    }

    // Parse the query to get the spec (synchronous LLM call, ~2-3s)
    const parsedSpec = await parseSearchQuery(query);
    const queryHash = computeSearchHash(query, parsedSpec);

    // Check for cached/running search with the same hash
    if (!input.fresh) {
      const cacheTtlRaw = await settingsRepo.getSetting(
        "jobSearchCacheTtlMinutes",
      );
      const cacheTtlParsed = cacheTtlRaw
        ? Number.parseInt(cacheTtlRaw, 10)
        : 60;
      const cacheTtl = Number.isFinite(cacheTtlParsed) ? cacheTtlParsed : 60;
      const cached = await findCachedSearch(queryHash, cacheTtl);
      if (cached) {
        logger.info("Returning cached job search", {
          searchId: cached.id,
          status: cached.status,
        });
        return ok(res, {
          searchId: cached.id,
          status: cached.status,
          parsedSpec: cached.parsedSpec,
          cached: true,
        });
      }
    }

    // Resolve sources from the registry
    const registry = await import("@server/extractors/registry").then((m) =>
      m.getExtractorRegistry(),
    );
    const availableSources = [...registry.manifestBySource.keys()];

    // Create the search record
    const search = await jobSearchRepo.createJobSearch({
      originalQuery: query,
      queryHash,
      parsedSpec,
      sourcesSearched: availableSources,
    });

    if (!search) {
      const existing = await jobSearchRepo.getJobSearchByHash(queryHash);
      if (existing) {
        return ok(res, {
          searchId: existing.id,
          status: existing.status,
          parsedSpec: existing.parsedSpec,
          cached: true,
        });
      }
      return fail(
        res,
        new AppError({
          status: 409,
          code: "CONFLICT",
          message: "A search with this query is already running.",
        }),
      );
    }

    // Launch the search in the background
    runWithRequestContext({}, () => {
      executeJobSearch(search.id, query).catch((error) => {
        logger.error("Background job search failed", {
          searchId: search.id,
          error,
        });
      });
    });

    return ok(res, {
      searchId: search.id,
      status: "running" as const,
      parsedSpec,
      cached: false,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to create job search", { error });
    return fail(
      res,
      new AppError({ status: 500, code: "INTERNAL_ERROR", message }),
    );
  }
});

/**
 * GET /api/job-search — List recent searches.
 */
jobSearchRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const searches = await jobSearchRepo.getRecentJobSearches(20);
    ok(res, searches);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    fail(res, new AppError({ status: 500, code: "INTERNAL_ERROR", message }));
  }
});

/**
 * GET /api/job-search/:id — Get a single search with results.
 */
jobSearchRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const search = await jobSearchRepo.getJobSearch(req.params.id);
    if (!search) {
      return fail(res, notFound("Search not found."));
    }
    ok(res, search);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    fail(res, new AppError({ status: 500, code: "INTERNAL_ERROR", message }));
  }
});

/**
 * GET /api/job-search/:id/progress — SSE progress stream.
 */
jobSearchRouter.get("/:id/progress", async (req: Request, res: Response) => {
  const searchId = req.params.id;
  const search = await jobSearchRepo.getJobSearch(searchId);
  if (!search) {
    return fail(res, notFound("Search not found."));
  }

  setupSse(res, {
    cacheControl: "no-cache, no-transform",
    disableBuffering: true,
    flushHeaders: true,
  });

  const unsubscribe = subscribeToSearchProgress(searchId, (event) => {
    writeSseData(res, event);
  });

  const stopHeartbeat = startSseHeartbeat(res);

  req.on("close", () => {
    stopHeartbeat();
    unsubscribe();
  });
});

/**
 * POST /api/job-search/:id/resend-email — Re-send the results email.
 */
jobSearchRouter.post(
  "/:id/resend-email",
  async (req: Request, res: Response) => {
    try {
      const search = await jobSearchRepo.getJobSearch(req.params.id);
      if (!search) {
        return fail(res, notFound("Search not found."));
      }
      if (search.status !== "completed") {
        return fail(
          res,
          badRequest("Search must be completed before sending email."),
        );
      }

      const publicBaseUrl =
        process.env.JOBOPS_PUBLIC_BASE_URL?.trim() || "http://localhost:3001";

      const emailResult = await sendSearchResultsEmail(search, publicBaseUrl);
      const now = new Date().toISOString();

      if (emailResult.success) {
        await jobSearchRepo.updateJobSearch(search.id, {
          emailStatus: "sent",
          emailSentAt: now,
        });
        ok(res, { message: "Email sent.", emailStatus: "sent" as const });
      } else {
        await jobSearchRepo.updateJobSearch(search.id, {
          emailStatus: "failed",
          emailError: emailResult.error ?? "Unknown email error",
        });
        ok(res, { emailStatus: "failed" as const, error: emailResult.error });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      fail(res, new AppError({ status: 500, code: "INTERNAL_ERROR", message }));
    }
  },
);
