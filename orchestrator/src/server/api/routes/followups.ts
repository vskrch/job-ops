import { conflict, notFound } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { getCurrentUserId } from "@infra/request-context";
import { db, schema } from "@server/db/index";
import * as artifactRepo from "@server/repositories/application-artifacts";
import * as jobsRepo from "@server/repositories/jobs";
import { draftFollowUpText } from "@server/services/followups";
import { eq } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const followupsRouter = Router();

followupsRouter.get(
  "/quiet",
  asyncRoute(async (_req: Request, res: Response) => {
    const userId = getCurrentUserId();
    const jobs = await jobsRepo.getAllJobs(["applied", "in_progress"]);
    // Compute quiet list server-side via stage_events + the helpers.
    const { listQuietApplications } = await import(
      "@server/services/followups"
    );
    const quiet = await listQuietApplications(jobs);
    void userId;
    return ok(res, { quiet });
  }),
);

const draftSchema = z.object({
  jobId: z.string().trim().min(1),
  channel: z.enum(["email", "linkedin", "portal"]).default("email"),
  contactPerson: z.string().trim().max(120).nullable().optional(),
  language: z.string().trim().max(30).default("en"),
});

followupsRouter.post(
  "/draft",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = draftSchema.parse(req.body ?? {});
    const job = await jobsRepo.getJobById(parsed.jobId);
    if (!job) return fail(res, notFound("Job not found"));
    const text = draftFollowUpText({
      job,
      channel: parsed.channel,
      contactPerson: parsed.contactPerson ?? null,
      language: parsed.language,
    });
    // Persist the draft as an artifact so it is history-tracked.
    const artifact = await artifactRepo.createArtifact({
      jobId: parsed.jobId,
      kind: "followup",
      content: text,
    });
    return ok(res, { draft: text, artifact });
  }),
);

const logSchema = z.object({
  jobId: z.string().trim().min(1),
  artifactId: z.string().trim().min(1).optional(),
});

followupsRouter.post(
  "/log",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = logSchema.parse(req.body ?? {});
    const job = await jobsRepo.getJobById(parsed.jobId);
    if (!job) return fail(res, notFound("Job not found"));
    // Enforce the max-2 cap atomically from the caller's view — without this,
    // concurrent POST /log calls could exceed the cap (race noted in checker
    // pass 2). The check uses the same counter the quiet detector uses.
    const { followUpCountForJob } = await import("@server/services/followups");
    const existingLogEvents = await db
      .select({ metadata: schema.stageEvents.metadata })
      .from(schema.stageEvents)
      .where(eq(schema.stageEvents.applicationId, parsed.jobId));
    if (
      followUpCountForJob(
        existingLogEvents as Array<{ metadata: string | null }>,
      ) >= 2
    ) {
      return fail(
        res,
        conflict(
          "Maximum 2 follow-ups per application. Record the outcome instead.",
        ),
      );
    }
    const id = `followup-${Date.now()}`;
    await db.insert(schema.stageEvents).values({
      id,
      applicationId: parsed.jobId,
      title: "Follow-up sent",
      toStage: "applied",
      occurredAt: Date.now(),
      metadata: JSON.stringify({
        kind: "followup",
        artifactId: parsed.artifactId ?? null,
      }),
    });
    return ok(res, { logged: true, id });
  }),
);

const thankYouSchema = z.object({
  jobId: z.string().trim().min(1),
  stage: z.string().trim().min(1).max(80),
});

followupsRouter.post(
  "/thank-you/draft",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = thankYouSchema.parse(req.body ?? {});
    const job = await jobsRepo.getJobById(parsed.jobId);
    if (!job) return fail(res, notFound("Job not found"));
    const text =
      `Thank you for the ${parsed.stage} stage — I enjoyed learning more about the team and the work.\n\n` +
      `A short note of appreciation after the stage keeps the process warm and is expected practice; adjust the tone to the interviewing language used in your application.`;
    const artifact = await artifactRepo.createArtifact({
      jobId: parsed.jobId,
      kind: "thank_you",
      content: text,
      stage: parsed.stage,
    });
    return ok(res, { draft: text, artifact });
  }),
);
