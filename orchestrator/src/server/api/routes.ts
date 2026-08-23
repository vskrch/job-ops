/**
 * API routes for the orchestrator.
 */

import { rateLimitMiddleware } from "@infra/rate-limit";
import { Router } from "express";
import { agenticSearchRouter } from "./routes/agentic-search";
import { authRouter } from "./routes/auth";
import { backupRouter } from "./routes/backup";
import { browserAgentRouter } from "./routes/browser-agent";
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
import { searchSchedulesRouter } from "./routes/search-schedules";
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
// Anti mail-bombing / token-guessing on the password reset flow:
// forgot-password shares the credential limiter; verify/reset get a
// separate, time-boxed budget (20 requests / 10 minutes / IP).
const resetLimiter = rateLimitMiddleware({ max: 20, windowMs: 600_000 });
apiRouter.use("/auth/forgot-password", authLimiter);
apiRouter.use("/auth/verify-reset-token", resetLimiter);
apiRouter.use("/auth/reset-password", resetLimiter);

// Expensive-work start endpoints (each fans out browser extractors and
// LLM calls) get a per-IP budget so one account or script cannot saturate
// the shared crawler/search slots for everyone: 6 heavy jobs / 5 min / IP.
// POST-only registrations: status polling and reads stay unlimited.
// Skipped under NODE_ENV=test, where suites legitimately fire bursts.
if (process.env.NODE_ENV !== "test") {
  const heavyWorkLimiter = rateLimitMiddleware({ max: 6, windowMs: 300_000 });
  apiRouter.post("/pipeline/run", heavyWorkLimiter);
  apiRouter.post("/job-search", heavyWorkLimiter);
  apiRouter.post("/agentic-searches", heavyWorkLimiter);
  apiRouter.post("/browser-agent/run", heavyWorkLimiter);
}

apiRouter.use("/auth", authRouter);
apiRouter.use("/jobs", jobsRouter);
apiRouter.use("/job-search", jobSearchRouter);
apiRouter.use("/agentic-searches", agenticSearchRouter);
apiRouter.use("/jobs/:id/chat", ghostwriterRouter);
apiRouter.use("/demo", demoRouter);
apiRouter.use("/settings", settingsRouter);
apiRouter.use("/pipeline", pipelineRouter);
apiRouter.use("/search-schedules", searchSchedulesRouter);
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
apiRouter.use("/browser-agent", browserAgentRouter);
apiRouter.use("/", extractorHealthRouter);
