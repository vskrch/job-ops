import { badRequest, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import {
  isBrowserAgentEnabled,
  runBrowserTask,
} from "@server/services/agentic/browser-task";
import { getEffectiveSettings } from "@server/services/settings";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const browserAgentRouter = Router();

const runTaskSchema = z.object({
  task: z.string().min(1).max(8000),
  url: z.string().url().optional(),
  maxSteps: z.number().int().min(1).max(50).optional(),
});

browserAgentRouter.post("/run", async (req: Request, res: Response) => {
  try {
    const settings = await getEffectiveSettings();
    if (!isBrowserAgentEnabled(settings)) {
      return fail(res, badRequest("Browser agent is not enabled"));
    }

    const parsed = runTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(
        res,
        badRequest("Invalid request body", parsed.error.flatten().fieldErrors),
      );
    }

    const result = await runBrowserTask(parsed.data, settings);
    if (!result.success && !result.disabled) {
      return fail(
        res,
        toAppError(new Error(result.error ?? "Browser task failed")),
      );
    }
    return ok(res, {
      result: result.result,
      steps: result.steps,
      ...(result.error ? { error: result.error } : {}),
      ...(result.disabled ? { disabled: true } : {}),
    });
  } catch (error) {
    return fail(res, toAppError(error));
  }
});

browserAgentRouter.get("/status", async (_req: Request, res: Response) => {
  try {
    const settings = await getEffectiveSettings();
    return ok(res, {
      enabled: isBrowserAgentEnabled(settings),
      baseUrl: process.env.BROWSER_USE_BASE_URL?.trim() ?? null,
    });
  } catch (error) {
    return fail(res, toAppError(error));
  }
});
