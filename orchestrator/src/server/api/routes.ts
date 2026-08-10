/**
 * API routes for the orchestrator.
 */

import { rateLimitMiddleware } from "@infra/rate-limit";
import { Router } from "express";
import { agenticSearchRouter } from "./routes/agentic-search";
import { authRouter } from "./routes/auth";
import { backupRouter } from "./routes/backup";
import { databaseRouter } from "./routes/database";
import { demoRouter } from "./routes/demo";
import { designResumeRouter } from "./routes/design-resume";
import { extractorHealthRouter } from "./routes/extractor-health";
import { ghostwriterRouter } from "./routes/ghostwriter";
import { jobSearchRouter } from "./routes/job-search";
import { jobsRouter } from "./routes/jobs";
import { manualJobsRouter } from "./routes/manual-jobs";
import { onboardingRouter } from "./routes/onboarding";
import { pipelineRouter } from "./routes/pipeline";
import { postApplicationProvidersRouter } from "./routes/post-application-providers";
import { postApplicationReviewRouter } from "./routes/post-application-review";
import { profileRouter } from "./routes/profile";
import { settingsRouter } from "./routes/settings";
import { tracerLinksRouter } from "./routes/tracer-links";
import { userProfileRouter } from "./routes/user-profile";
import { visaSponsorsRouter } from "./routes/visa-sponsors";
import { webhookRouter } from "./routes/webhook";

export const apiRouter = Router();

// Brute-force protection on credential endpoints: 10 attempts / minute / IP.
const authLimiter = rateLimitMiddleware({ max: 10, windowMs: 60_000 });
apiRouter.use("/auth/login", authLimiter);
apiRouter.use("/auth/register", authLimiter);

apiRouter.use("/auth", authRouter);
apiRouter.use("/jobs", jobsRouter);
apiRouter.use("/job-search", jobSearchRouter);
apiRouter.use("/agentic-searches", agenticSearchRouter);
apiRouter.use("/jobs/:id/chat", ghostwriterRouter);
apiRouter.use("/demo", demoRouter);
apiRouter.use("/settings", settingsRouter);
apiRouter.use("/pipeline", pipelineRouter);
apiRouter.use("/post-application", postApplicationProvidersRouter);
apiRouter.use("/post-application", postApplicationReviewRouter);
apiRouter.use("/manual-jobs", manualJobsRouter);
apiRouter.use("/webhook", webhookRouter);
apiRouter.use("/profile", profileRouter);
apiRouter.use("/database", databaseRouter);
apiRouter.use("/design-resume", designResumeRouter);
apiRouter.use("/visa-sponsors", visaSponsorsRouter);
apiRouter.use("/onboarding", onboardingRouter);
apiRouter.use("/backups", backupRouter);
apiRouter.use("/tracer-links", tracerLinksRouter);
apiRouter.use("/user-profile", userProfileRouter);
apiRouter.use("/", extractorHealthRouter);
