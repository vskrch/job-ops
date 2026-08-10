/**
 * API routes for agentic search (ADR-001 v2).
 *
 * POST   /api/agentic-searches              — start a new agentic search
 * GET    /api/agentic-searches              — list recent agentic searches
 * GET    /api/agentic-searches/:id          — get search status + results
 * POST   /api/agentic-searches/:id/cancel   — cancel a running search
 * GET    /api/agentic-searches/:id/progress — SSE progress stream
 */

import { badRequest, notFound, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { setupSse, startSseHeartbeat, writeSseData } from "@infra/sse";
import * as agenticRepo from "@server/repositories/agentic-search";
import {
  cancelAgenticSearch,
  isAgenticSearchEnabled,
  startAgenticSearch,
  subscribeToAgenticSearchProgress,
} from "@server/services/agentic";
import type { AgenticSearchStatus } from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const agenticSearchRouter = Router();

const createSearchSchema = z.object({
  query: z.string().min(1).max(2000),
});

/** Terminal statuses that never emit further progress events. */
const TERMINAL_STATUSES: ReadonlySet<AgenticSearchStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
  "partial",
  "timed_out",
]);

agenticSearchRouter.post("/", async (req: Request, res: Response) => {
  try {
    if (!(await isAgenticSearchEnabled())) {
      return fail(res, badRequest("Agentic search is not enabled"));
    }

    const parsed = createSearchSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(
        res,
        badRequest("Invalid request body", parsed.error.flatten().fieldErrors),
      );
    }

    const search = await startAgenticSearch(parsed.data.query);
    return ok(res, { searchId: search.id, status: search.status }, 201);
  } catch (error) {
    return fail(res, toAppError(error));
  }
});

agenticSearchRouter.get("/", async (req: Request, res: Response) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? "20"), 10);
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(100, rawLimit))
      : 20;
    const searches = await agenticRepo.listAgenticSearches(limit);
    return ok(res, { searches });
  } catch (error) {
    return fail(res, toAppError(error));
  }
});

agenticSearchRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const search = await agenticRepo.getAgenticSearch(req.params.id);
    if (!search) {
      return fail(res, notFound("Agentic search not found"));
    }
    return ok(res, {
      id: search.id,
      status: search.status,
      currentStep: search.currentStep,
      iterationCount: search.iterationCount,
      maxIterations: search.maxIterations,
      jobsFound: search.results?.totalDiscovered ?? 0,
      jobsUnique: search.results?.totalAfterFilter ?? 0,
      jobsMatching: search.results?.highlyRelevant ?? 0,
      budgetUsed: search.budgetUsed,
      results: search.results,
      goal: search.goal,
      searchExpansions: search.searchExpansions,
      fallbackSearchId: search.fallbackSearchId,
      startedAt: search.startedAt,
      completedAt: search.completedAt,
      failureReason: search.failureReason,
    });
  } catch (error) {
    return fail(res, toAppError(error));
  }
});

agenticSearchRouter.post("/:id/cancel", async (req: Request, res: Response) => {
  try {
    const search = await cancelAgenticSearch(req.params.id);
    if (!search) {
      return fail(res, notFound("Agentic search not found"));
    }
    return ok(res, { id: search.id, status: search.status });
  } catch (error) {
    return fail(res, toAppError(error));
  }
});

agenticSearchRouter.get(
  "/:id/progress",
  async (req: Request, res: Response) => {
    try {
      const search = await agenticRepo.getAgenticSearch(req.params.id);
      if (!search) {
        return fail(res, notFound("Agentic search not found"));
      }

      setupSse(res, { disableBuffering: true, flushHeaders: true });
      const stopHeartbeat = startSseHeartbeat(res);

      if (TERMINAL_STATUSES.has(search.status)) {
        if (search.status === "completed") {
          writeSseData(res, {
            type: "agentic_completed",
            searchId: search.id,
            results: search.results,
            sequence: 0,
          });
        } else {
          writeSseData(res, {
            type: "agentic_failed",
            searchId: search.id,
            error:
              search.status === "cancelled"
                ? "Search was cancelled"
                : (search.failureReason ?? "Search failed"),
            fallbackSearchId: search.fallbackSearchId,
            sequence: 0,
          });
        }
        stopHeartbeat();
        res.end();
        return;
      }

      const unsubscribe = subscribeToAgenticSearchProgress(
        req.params.id,
        (event) => {
          writeSseData(res, event);
          if (
            event.type === "agentic_completed" ||
            event.type === "agentic_failed"
          ) {
            stopHeartbeat();
            unsubscribe();
            res.end();
          }
        },
      );

      req.on("close", () => {
        stopHeartbeat();
        unsubscribe();
      });
    } catch (error) {
      return fail(res, toAppError(error));
    }
  },
);
