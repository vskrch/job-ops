import {
  AppError,
  badRequest,
  conflict,
  notFound,
  requestTimeout,
  serviceUnavailable,
} from "@infra/errors";
import { fail, ok, okWithMeta } from "@infra/http";
import { logger } from "@infra/logger";
import {
  getCurrentUserId,
  getRequestId,
  runWithRequestContext,
} from "@infra/request-context";
import { setupSse, startSseHeartbeat, writeSseData } from "@infra/sse";
import { isDemoMode } from "@server/config/demo";
import {
  type ExtractorRegistry,
  getExtractorRegistry,
} from "@server/extractors/registry";
import {
  getPipelineStatus,
  getProgress,
  requestPipelineCancel,
  runPipeline,
  subscribeToProgress,
} from "@server/pipeline/index";
import * as pipelineRepo from "@server/repositories/pipeline";
import * as scheduleRepo from "@server/repositories/pipeline-schedules";
import { simulatePipelineRun } from "@server/services/demo-simulator";
import {
  getPipelineSchedules,
  refreshPipelineScheduler,
} from "@server/services/pipeline-scheduler";
import { PIPELINE_EXTRACTOR_SOURCE_IDS } from "@shared/extractors";
import type { PipelineStatusResponse } from "@shared/types";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const pipelineRouter = Router();

/**
 * GET /api/pipeline/status - Get pipeline status for the current user
 */
pipelineRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const userId = getCurrentUserId();
    const { isRunning, activeRunCount, maxConcurrentRuns } =
      getPipelineStatus(userId);
    const lastRun = await pipelineRepo.getLatestPipelineRun();
    const schedules = await getPipelineSchedules();
    const nextScheduledRun =
      schedules
        .filter((s) => s.enabled && s.nextRun)
        .map((s) => s.nextRun as string)
        .sort()[0] ?? null;
    const progress = getProgress(userId);
    const data: PipelineStatusResponse = {
      isRunning,
      activeRunCount,
      maxConcurrentRuns,
      lastRun,
      nextScheduledRun,
      progress: isRunning ? progress : undefined,
    };
    ok(res, data);
  } catch (error) {
    logger.error("Failed to get pipeline status", {
      route: "/api/pipeline/status",
      error,
    });
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      }),
    );
  }
});

/**
 * GET /api/pipeline/schedules - List all pipeline schedules.
 */
pipelineRouter.get("/schedules", async (_req: Request, res: Response) => {
  try {
    const schedules = await getPipelineSchedules();
    ok(res, schedules);
  } catch (error) {
    logger.error("Failed to list pipeline schedules", {
      route: "/api/pipeline/schedules",
      error,
    });
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      }),
    );
  }
});

const scheduleSourcesSchema = z.array(
  z.enum(
    PIPELINE_EXTRACTOR_SOURCE_IDS as [
      (typeof PIPELINE_EXTRACTOR_SOURCE_IDS)[number],
      ...(typeof PIPELINE_EXTRACTOR_SOURCE_IDS)[number][],
    ],
  ),
);

const createScheduleSchema = z.object({
  label: z.string().trim().min(1).max(200),
  enabled: z.boolean().optional(),
  hour: z.number().int().min(0).max(23),
  sources: scheduleSourcesSchema,
  searchTerms: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .nullable()
    .optional(),
  country: z.string().trim().max(100).nullable().optional(),
  cityLocations: z
    .array(z.string().trim().min(1).max(200))
    .nullable()
    .optional(),
  workplaceTypes: z
    .array(z.string().trim().min(1).max(50))
    .nullable()
    .optional(),
  topN: z.number().int().min(1).max(50).nullable().optional(),
  minSuitabilityScore: z.number().int().min(0).max(100).nullable().optional(),
});

/**
 * POST /api/pipeline/schedules - Create a new pipeline schedule.
 */
pipelineRouter.post("/schedules", async (req: Request, res: Response) => {
  try {
    const input = createScheduleSchema.parse(req.body);

    if (isDemoMode()) {
      return fail(res, badRequest("Scheduling is not available in demo mode."));
    }

    await scheduleRepo.createPipelineSchedule({
      label: input.label,
      enabled: input.enabled ?? false,
      hour: input.hour,
      sources: input.sources,
      searchTerms: input.searchTerms ?? null,
      country: input.country ?? null,
      cityLocations: input.cityLocations ?? null,
      workplaceTypes: input.workplaceTypes ?? null,
      topN: input.topN ?? null,
      minSuitabilityScore: input.minSuitabilityScore ?? null,
    });

    await refreshPipelineScheduler();
    const schedules = await getPipelineSchedules();
    ok(res, schedules);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    logger.error("Failed to create pipeline schedule", {
      route: "/api/pipeline/schedules",
      error,
    });
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      }),
    );
  }
});

const updateScheduleSchema = z.object({
  label: z.string().trim().min(1).max(200).optional(),
  enabled: z.boolean().optional(),
  hour: z.number().int().min(0).max(23).optional(),
  sources: scheduleSourcesSchema.optional(),
  searchTerms: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .nullable()
    .optional(),
  country: z.string().trim().max(100).nullable().optional(),
  cityLocations: z
    .array(z.string().trim().min(1).max(200))
    .nullable()
    .optional(),
  workplaceTypes: z
    .array(z.string().trim().min(1).max(50))
    .nullable()
    .optional(),
  topN: z.number().int().min(1).max(50).nullable().optional(),
  minSuitabilityScore: z.number().int().min(0).max(100).nullable().optional(),
});

/**
 * PUT /api/pipeline/schedules/:id - Update a pipeline schedule.
 */
pipelineRouter.put("/schedules/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const input = updateScheduleSchema.parse(req.body);

    if (isDemoMode()) {
      return fail(res, badRequest("Scheduling is not available in demo mode."));
    }

    const existing = await scheduleRepo.getPipelineScheduleById(id);
    if (!existing) {
      return fail(res, notFound("Pipeline schedule not found"));
    }

    await scheduleRepo.updatePipelineSchedule(id, {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.hour !== undefined ? { hour: input.hour } : {}),
      ...(input.sources !== undefined ? { sources: input.sources } : {}),
      ...(input.searchTerms !== undefined
        ? { searchTerms: input.searchTerms }
        : {}),
      ...(input.country !== undefined ? { country: input.country } : {}),
      ...(input.cityLocations !== undefined
        ? { cityLocations: input.cityLocations }
        : {}),
      ...(input.workplaceTypes !== undefined
        ? { workplaceTypes: input.workplaceTypes }
        : {}),
      ...(input.topN !== undefined ? { topN: input.topN } : {}),
      ...(input.minSuitabilityScore !== undefined
        ? { minSuitabilityScore: input.minSuitabilityScore }
        : {}),
    });

    await refreshPipelineScheduler();
    const schedules = await getPipelineSchedules();
    ok(res, schedules);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    logger.error("Failed to update pipeline schedule", {
      route: "/api/pipeline/schedules",
      error,
    });
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      }),
    );
  }
});

/**
 * DELETE /api/pipeline/schedules/:id - Delete a pipeline schedule.
 */
pipelineRouter.delete("/schedules/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;

    if (isDemoMode()) {
      return fail(res, badRequest("Scheduling is not available in demo mode."));
    }

    const deleted = await scheduleRepo.deletePipelineSchedule(id);
    if (!deleted) {
      return fail(res, notFound("Pipeline schedule not found"));
    }

    await refreshPipelineScheduler();
    const schedules = await getPipelineSchedules();
    ok(res, schedules);
  } catch (error) {
    logger.error("Failed to delete pipeline schedule", {
      route: "/api/pipeline/schedules",
      error,
    });
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      }),
    );
  }
});

/**
 * GET /api/pipeline/progress - Server-Sent Events endpoint for live progress
 */
pipelineRouter.get("/progress", (req: Request, res: Response) => {
  const userId = getCurrentUserId();
  setupSse(res, {
    cacheControl: "no-cache, no-transform",
    disableBuffering: true,
    flushHeaders: true,
  });

  // Send initial progress
  const sendProgress = (data: unknown) => {
    writeSseData(res, data);
  };

  // Subscribe to progress updates for this specific user
  const unsubscribe = subscribeToProgress(sendProgress, userId);

  // Send heartbeat every 30 seconds to keep connection alive
  const stopHeartbeat = startSseHeartbeat(res);

  // Cleanup on close
  req.on("close", () => {
    stopHeartbeat();
    unsubscribe();
  });
});

/**
 * GET /api/pipeline/runs - Get recent pipeline runs
 */
pipelineRouter.get("/runs", async (_req: Request, res: Response) => {
  try {
    const runs = await pipelineRepo.getRecentPipelineRuns(20);
    ok(res, runs);
  } catch (error) {
    logger.error("Failed to list pipeline runs", {
      route: "/api/pipeline/runs",
      error,
    });
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      }),
    );
  }
});

/**
 * POST /api/pipeline/run - Trigger the pipeline manually
 */
const runPipelineSchema = z.object({
  topN: z.number().min(1).max(50).optional(),
  minSuitabilityScore: z.number().min(0).max(100).optional(),
  sources: z
    .array(
      z.enum(
        PIPELINE_EXTRACTOR_SOURCE_IDS as [
          (typeof PIPELINE_EXTRACTOR_SOURCE_IDS)[number],
          ...(typeof PIPELINE_EXTRACTOR_SOURCE_IDS)[number][],
        ],
      ),
    )
    .optional(),
});

pipelineRouter.post("/run", async (req: Request, res: Response) => {
  try {
    const config = runPipelineSchema.parse(req.body);
    if (config.sources && config.sources.length > 0) {
      let registry: ExtractorRegistry;
      try {
        registry = await getExtractorRegistry();
      } catch (error) {
        logger.error(
          "Extractor registry unavailable during source validation",
          {
            route: "/api/pipeline/run",
            error,
          },
        );
        return fail(
          res,
          serviceUnavailable(
            "Extractor registry is unavailable. Try again after fixing startup errors.",
          ),
        );
      }
      const unavailableSources = config.sources.filter(
        (source) => !registry.manifestBySource.has(source),
      );
      if (unavailableSources.length > 0) {
        return fail(
          res,
          badRequest(
            `Requested sources are not available at runtime: ${unavailableSources.join(", ")}`,
            { unavailableSources },
          ),
        );
      }
    }

    if (isDemoMode()) {
      const simulated = await simulatePipelineRun(config);
      return okWithMeta(res, simulated, { simulated: true });
    }

    const userId = getCurrentUserId();
    const requestId = getRequestId();

    // Start pipeline in background scoped to the authenticated user
    runWithRequestContext({ userId, requestId }, () => {
      runPipeline(config).catch((error) => {
        logger.error("Background pipeline run failed", { error, userId });
      });
    });
    ok(res, { message: "Pipeline started" });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    if (error instanceof Error && error.name === "AbortError") {
      return fail(res, requestTimeout("Request timed out"));
    }
    logger.error("Failed to start pipeline run", {
      route: "/api/pipeline/run",
      error,
    });
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      }),
    );
  }
});

const cancelSchema = z.object({
  pipelineRunId: z.string().optional(),
});

/**
 * POST /api/pipeline/cancel - Request cancellation of active pipeline run
 */
pipelineRouter.post("/cancel", async (req: Request, res: Response) => {
  try {
    const userId = getCurrentUserId();
    const input = cancelSchema.parse(req.body ?? {});
    const cancelResult = requestPipelineCancel(input.pipelineRunId, userId);
    if (!cancelResult.accepted) {
      return fail(res, conflict("No running pipeline to cancel"));
    }

    logger.info("Pipeline cancellation requested", {
      route: "/api/pipeline/cancel",
      action: "cancel",
      status: "accepted",
      pipelineRunId: cancelResult.pipelineRunId,
      alreadyRequested: cancelResult.alreadyRequested,
      userId,
    });

    ok(res, {
      message: cancelResult.alreadyRequested
        ? "Pipeline cancellation already requested"
        : "Pipeline cancellation requested",
      pipelineRunId: cancelResult.pipelineRunId,
      alreadyRequested: cancelResult.alreadyRequested,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    logger.error("Failed to request pipeline cancellation", {
      route: "/api/pipeline/cancel",
      error,
    });
    fail(
      res,
      new AppError({
        status: 500,
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      }),
    );
  }
});
