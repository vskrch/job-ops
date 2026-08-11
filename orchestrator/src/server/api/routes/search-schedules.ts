/**
 * API routes for periodic search schedules.
 *
 * GET    /api/search-schedules          — list schedules
 * POST   /api/search-schedules          — create
 * PUT    /api/search-schedules/:id      — update
 * DELETE /api/search-schedules/:id      — delete
 * POST   /api/search-schedules/:id/run  — trigger a schedule manually
 */

import { AppError, badRequest, notFound } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { isDemoMode } from "@server/config/demo";
import * as scheduleRepo from "@server/repositories/search-schedules";
import {
  getSearchSchedules,
  refreshSearchScheduler,
} from "@server/services/search-scheduler";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const searchSchedulesRouter = Router();

const frequencySchema = z.enum(["hourly", "daily"]);

const createScheduleSchema = z.object({
  label: z.string().trim().min(1).max(200),
  enabled: z.boolean().optional(),
  frequency: frequencySchema.optional(),
  hour: z.number().int().min(0).max(23).nullable().optional(),
  minute: z.number().int().min(0).max(59).optional(),
  query: z.string().trim().min(1).max(2000),
  notifyEmail: z.boolean().optional(),
  notifyWebhook: z.boolean().optional(),
});

const updateScheduleSchema = createScheduleSchema.partial();

/**
 * GET /api/search-schedules — List all search schedules.
 */
searchSchedulesRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const schedules = await getSearchSchedules();
    ok(res, schedules);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    fail(res, new AppError({ status: 500, code: "INTERNAL_ERROR", message }));
  }
});

/**
 * POST /api/search-schedules — Create a new search schedule.
 */
searchSchedulesRouter.post("/", async (req: Request, res: Response) => {
  try {
    if (isDemoMode()) {
      return fail(
        res,
        badRequest("Search scheduling is not available in demo mode."),
      );
    }

    const input = createScheduleSchema.parse(req.body);

    // Validate: daily schedules should have an hour.
    const frequency = input.frequency ?? "daily";
    if (frequency === "daily" && input.hour == null) {
      return fail(
        res,
        badRequest("Hour is required for daily schedules.", {
          hint: "Provide an hour (0-23) or use frequency 'hourly'.",
        }),
      );
    }

    await scheduleRepo.createSearchSchedule({
      label: input.label,
      enabled: input.enabled ?? true,
      frequency,
      hour: input.hour ?? null,
      minute: input.minute ?? 0,
      query: input.query,
      notifyEmail: input.notifyEmail ?? true,
      notifyWebhook: input.notifyWebhook ?? true,
    });

    await refreshSearchScheduler();
    const schedules = await getSearchSchedules();
    ok(res, schedules);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    fail(res, new AppError({ status: 500, code: "INTERNAL_ERROR", message }));
  }
});

/**
 * PUT /api/search-schedules/:id — Update a search schedule.
 */
searchSchedulesRouter.put("/:id", async (req: Request, res: Response) => {
  try {
    if (isDemoMode()) {
      return fail(
        res,
        badRequest("Search scheduling is not available in demo mode."),
      );
    }

    const id = req.params.id;
    const input = updateScheduleSchema.parse(req.body);

    // Validate: if frequency is being set to daily, hour must be present (either
    // in the input or already in the existing record).
    if (input.frequency === "daily" && input.hour === undefined) {
      // Hour not provided in update — keep existing or default to 2.
      // The repository handles this; no validation needed here.
    }
    if (input.frequency === "daily" && input.hour === null) {
      return fail(
        res,
        badRequest("Hour is required for daily schedules.", {
          hint: "Provide an hour (0-23) or use frequency 'hourly'.",
        }),
      );
    }

    const existing = await scheduleRepo.getSearchScheduleById(id);
    if (!existing) {
      return fail(res, notFound("Search schedule not found"));
    }

    await scheduleRepo.updateSearchSchedule(id, {
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
      ...(input.hour !== undefined ? { hour: input.hour } : {}),
      ...(input.minute !== undefined ? { minute: input.minute } : {}),
      ...(input.query !== undefined ? { query: input.query } : {}),
      ...(input.notifyEmail !== undefined
        ? { notifyEmail: input.notifyEmail }
        : {}),
      ...(input.notifyWebhook !== undefined
        ? { notifyWebhook: input.notifyWebhook }
        : {}),
    });

    await refreshSearchScheduler();
    const schedules = await getSearchSchedules();
    ok(res, schedules);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return fail(res, badRequest(error.message, error.flatten()));
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    fail(res, new AppError({ status: 500, code: "INTERNAL_ERROR", message }));
  }
});

/**
 * DELETE /api/search-schedules/:id — Delete a search schedule.
 */
searchSchedulesRouter.delete("/:id", async (req: Request, res: Response) => {
  try {
    if (isDemoMode()) {
      return fail(
        res,
        badRequest("Search scheduling is not available in demo mode."),
      );
    }

    const id = req.params.id;
    const deleted = await scheduleRepo.deleteSearchSchedule(id);
    if (!deleted) {
      return fail(res, notFound("Search schedule not found"));
    }

    await refreshSearchScheduler();
    const schedules = await getSearchSchedules();
    ok(res, schedules);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    fail(res, new AppError({ status: 500, code: "INTERNAL_ERROR", message }));
  }
});

/**
 * POST /api/search-schedules/:id/run — Trigger a search schedule manually.
 */
searchSchedulesRouter.post("/:id/run", async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const existing = await scheduleRepo.getSearchScheduleById(id);
    if (!existing) {
      return fail(res, notFound("Search schedule not found"));
    }

    if (isDemoMode()) {
      return ok(res, {
        searchId: "demo-search",
        status: "completed",
        resultsCount: 0,
      });
    }

    // Start the search in the background and respond immediately with the
    // search id once it's created. The search execution itself runs async.
    const { runSearchScheduleNow } = await import(
      "@server/services/search-scheduler"
    );

    // Run synchronously up to search creation, then let execution continue in
    // the background. The caller gets the searchId for polling results.
    const result = await runSearchScheduleNow(id);

    if (!result.searchId) {
      return fail(
        res,
        new AppError({
          status: 500,
          code: "INTERNAL_ERROR",
          message: "Failed to start search for this schedule.",
        }),
      );
    }

    logger.info("Manual search schedule run triggered", {
      scheduleId: id,
      searchId: result.searchId,
    });

    ok(res, {
      searchId: result.searchId,
      status: "completed",
      resultsCount: result.resultsCount,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    fail(res, new AppError({ status: 500, code: "INTERNAL_ERROR", message }));
  }
});
