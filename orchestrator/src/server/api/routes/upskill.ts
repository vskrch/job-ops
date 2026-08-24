import { asyncRoute, ok } from "@infra/http";
import { getCurrentUserId } from "@infra/request-context";
import { db, schema } from "@server/db/index";
import * as artifactRepo from "@server/repositories/application-artifacts";
import { buildHeatmap } from "@server/services/upskill";
import { and, eq } from "drizzle-orm";
import { type Request, type Response, Router } from "express";

export const upskillRouter = Router();

upskillRouter.post(
  "/heatmap",
  asyncRoute(async (_req: Request, res: Response) => {
    const userId = getCurrentUserId();
    const rows = await db
      .select({ scoreBreakdown: schema.jobs.scoreBreakdown })
      .from(schema.jobs)
      .where(and(eq(schema.jobs.userId, userId)));
    const breakdowns = rows
      .map((r) => {
        if (!r.scoreBreakdown) return null;
        try {
          return JSON.parse(r.scoreBreakdown as unknown as string);
        } catch {
          return null;
        }
      })
      .filter(Boolean);
    const heatmap = buildHeatmap(
      breakdowns as Array<{
        breakdown: import("@shared/score-breakdown").ScoreBreakdown | null;
      }> as unknown as Parameters<typeof buildHeatmap>[0],
    );
    const content = JSON.stringify(
      { generatedAt: new Date().toISOString(), heatmap },
      null,
      2,
    );
    const artifact = await artifactRepo.createArtifact({
      jobId: "upskill",
      kind: "upskill",
      content,
    });
    return ok(res, { heatmap, artifact });
  }),
);
