import { badRequest, notFound } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { getCurrentUserId } from "@infra/request-context";
import * as artifactRepo from "@server/repositories/application-artifacts";
import * as jobsRepo from "@server/repositories/jobs";
import * as userProfileRepo from "@server/repositories/user-profile";
import { buildPrepPackMarkdown } from "@server/services/interview-prep";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const interviewPrepRouter = Router();

const generateSchema = z.object({
  jobId: z.string().trim().min(1),
  stage: z.string().trim().min(1).max(80).default("interview"),
  interviewerNames: z
    .array(z.string().trim().min(1).max(120))
    .max(6)
    .optional(),
  format: z.string().trim().max(80).nullable().optional(),
});

interviewPrepRouter.post(
  "/generate",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = generateSchema.parse(req.body ?? {});
    const job = await jobsRepo.getJobById(parsed.jobId);
    if (!job) return fail(res, notFound("Job not found"));
    const profile = await userProfileRepo.getCurrentUserProfile();
    const starExamples = profile?.starExamples ?? [];
    // Prior stage feedback from stage_events for this job.
    const { db, schema } = await import("@server/db/index");
    const { and, eq } = await import("drizzle-orm");
    void getCurrentUserId;
    const events = await db
      .select({ metadata: schema.stageEvents.metadata })
      .from(schema.stageEvents)
      .where(and(eq(schema.stageEvents.applicationId, parsed.jobId)));
    const priorFeedback: string[] = [];
    for (const e of events) {
      try {
        const m = e.metadata
          ? (JSON.parse(e.metadata as unknown as string) as { notes?: string })
          : null;
        if (m?.notes) priorFeedback.push(String(m.notes).slice(0, 300));
      } catch {}
    }
    const content = buildPrepPackMarkdown({
      job,
      stage: parsed.stage,
      interviewerNames: parsed.interviewerNames ?? null,
      format: parsed.format ?? null,
      starExamples,
      priorFeedback,
    });
    const artifact = await artifactRepo.createArtifact({
      jobId: parsed.jobId,
      kind: "prep_pack",
      content,
      stage: parsed.stage,
    });
    return ok(res, { artifact, content });
  }),
);

interviewPrepRouter.get(
  "/:jobId",
  asyncRoute(async (req: Request, res: Response) => {
    const jobId = String(req.params.jobId ?? "").trim();
    if (!jobId) return fail(res, badRequest("jobId is required"));
    const job = await jobsRepo.getJobById(jobId);
    if (!job) return fail(res, notFound("Job not found"));
    const artifacts = await artifactRepo.listArtifactsForJob(jobId);
    return ok(res, {
      artifacts: artifacts.filter((a) => a.kind === "prep_pack"),
    });
  }),
);
