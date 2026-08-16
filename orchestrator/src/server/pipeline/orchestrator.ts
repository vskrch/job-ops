/**
 * Main pipeline logic - orchestrates the daily job processing flow.
 *
 * Flow:
 * 1. Run crawler to discover new jobs
 * 2. Score jobs for suitability
 * 3. Leave all jobs in "discovered" for manual processing
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { logger } from "@infra/logger";
import { trackServerProductEvent } from "@infra/product-analytics";
import {
  getCurrentUserId,
  getRequestId,
  runWithRequestContext,
} from "@infra/request-context";
import type {
  PipelineConfig,
  PipelineRunConfigSnapshot,
  ResumeProfile,
} from "@shared/types";
import { getDataDir } from "../config/dataDir";
import * as jobsRepo from "../repositories/jobs";
import * as pipelineRepo from "../repositories/pipeline";
import { getSetting } from "../repositories/settings";
import { generatePdf } from "../services/pdf";
import { getProfile } from "../services/profile";
import { pickProjectIdsForJob } from "../services/projectSelection";
import {
  extractProjectsFromProfile,
  resolveResumeProjectsSettings,
} from "../services/resumeProjects";
import { generateTailoring } from "../services/summary";
import { progressHelpers, resetProgress } from "./progress";
import {
  discoverJobsStep,
  importJobsStep,
  loadProfileStep,
  notifyPipelineWebhookStep,
  processJobsStep,
  scoreJobsStep,
  selectJobsStep,
} from "./steps";

const DEFAULT_CONFIG: PipelineConfig = {
  topN: 10,
  minSuitabilityScore: 50,
  // Keep Glassdoor opt-in via source picker/settings; do not enable by default.
  sources: ["indeed", "linkedin"],
  outputDir: join(getDataDir(), "pdfs"),
  enableCrawling: true,
  enableScoring: true,
  enableImporting: true,
  enableAutoTailoring: true,
};

function safeParseSkills(
  raw: string | null | undefined,
): Array<{ name: string; keywords: string[] }> {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const groups: Array<{ name: string; keywords: string[] }> = [];
    const legacyKeywords: string[] = [];

    for (const item of parsed) {
      if (typeof item === "string") {
        const keyword = item.trim();
        if (keyword) legacyKeywords.push(keyword);
        continue;
      }
      if (typeof item !== "object" || item === null) continue;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      const keywordsRaw = Array.isArray(record.keywords)
        ? record.keywords
        : typeof record.keywords === "string"
          ? record.keywords.split(",")
          : [];
      const keywords = keywordsRaw
        .filter((k): k is string => typeof k === "string")
        .map((k) => k.trim())
        .filter(Boolean);
      if (!name && keywords.length === 0) continue;
      groups.push({ name, keywords });
    }

    if (legacyKeywords.length > 0) {
      groups.push({ name: "Skills", keywords: legacyKeywords });
    }

    return groups;
  } catch {
    logger.warn("Failed to parse tailoredSkills JSON, using empty array", {
      length: raw.length,
    });
    return [];
  }
}

function safeParseExperienceBullets(
  raw: string | null | undefined,
): Array<{ id: string; bullets: { id: string; text: string }[] }> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const out: Array<{ id: string; bullets: { id: string; text: string }[] }> =
      [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const e = entry as Record<string, unknown>;
      if (typeof e.id !== "string" || !Array.isArray(e.bullets)) continue;
      const bullets: { id: string; text: string }[] = [];
      for (const b of e.bullets) {
        if (!b || typeof b !== "object") continue;
        const bb = b as Record<string, unknown>;
        if (typeof bb.text === "string" && bb.text.trim().length > 0) {
          bullets.push({
            id: typeof bb.id === "string" ? bb.id : "",
            text: bb.text,
          });
        }
      }
      if (bullets.length > 0) {
        out.push({ id: e.id, bullets });
      }
    }
    return out.length > 0 ? out : null;
  } catch {
    logger.warn("Failed to parse tailoredExperienceBullets JSON, ignoring", {
      length: raw.length,
    });
    return null;
  }
}

// Multi-tenant counting semaphore and run tracking.
// Concurrency is enforced per-user account so runs for User A do not
// block or interfere with runs for User B.
const activeRunIdsByUserId = new Map<string, Set<string>>();
const cancelRequestedByRunId = new Set<string>();
const cancelAllByUserId = new Map<string, boolean>();
let maxConcurrentPipelinesPerUser = 3;

class PipelineCancelledError extends Error {
  constructor(message = "Cancelled by user request") {
    super(message);
    this.name = "PipelineCancelledError";
  }
}

function resolveUser(explicitUserId?: string): string {
  return explicitUserId || getCurrentUserId();
}

function ensureNotCancelled(runId: string, explicitUserId?: string): void {
  const userId = resolveUser(explicitUserId);
  if (cancelAllByUserId.get(userId) || cancelRequestedByRunId.has(runId)) {
    throw new PipelineCancelledError();
  }
}

async function resolveExcludeRunIds(): Promise<string[]> {
  try {
    const raw = await getSetting("pipelineExcludeRunIds");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

async function buildRunConfigSnapshot(
  config: PipelineConfig,
): Promise<PipelineRunConfigSnapshot> {
  const [searchTermsRaw, countryRaw, citiesRaw, workplaceRaw] =
    await Promise.all([
      getSetting("searchTerms").catch(() => null),
      getSetting("jobspyCountryIndeed").catch(() => null),
      getSetting("searchCities").catch(() => null),
      getSetting("workplaceTypes").catch(() => null),
    ]);

  const parseStringList = (raw: string | null): string[] => {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter(
          (value): value is string => typeof value === "string",
        );
      }
    } catch {
      // fall through
    }
    return raw
      .split("|")
      .map((value) => value.trim())
      .filter(Boolean);
  };

  return {
    topN: config.topN,
    minSuitabilityScore: config.minSuitabilityScore,
    sources: config.sources,
    searchTerms: parseStringList(searchTermsRaw),
    country: countryRaw?.trim() || null,
    cityLocations: parseStringList(citiesRaw),
    workplaceTypes: parseStringList(workplaceRaw),
    hoursOld: config.hoursOld ?? null,
    excludeRunIds: config.excludeRunIds ?? [],
  };
}

/**
 * Run the full job discovery and processing pipeline.
 */
export async function runPipeline(
  config: Partial<PipelineConfig> = {},
  explicitUserId?: string,
): Promise<{
  success: boolean;
  jobsDiscovered: number;
  jobsProcessed: number;
  error?: string;
}> {
  const userId = resolveUser(explicitUserId);
  let userActiveRuns = activeRunIdsByUserId.get(userId);
  if (!userActiveRuns) {
    userActiveRuns = new Set<string>();
    activeRunIdsByUserId.set(userId, userActiveRuns);
  }

  if (userActiveRuns.size >= maxConcurrentPipelinesPerUser) {
    return {
      success: false,
      jobsDiscovered: 0,
      jobsProcessed: 0,
      error: `Pipeline concurrency limit reached (${userActiveRuns.size} running for your account). Try again shortly.`,
    };
  }

  const pendingId = `pending-${randomUUID()}`;
  userActiveRuns.add(pendingId);
  resetProgress(userId);
  let pipelineRunId: string | null = null;

  try {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    // Resolve excluded runs from the persisted setting (set via Run > Advanced).
    const excludeRunIds = await resolveExcludeRunIds();
    const effectiveConfig: PipelineConfig = {
      ...mergedConfig,
      excludeRunIds,
    };

    // Snapshot the effective run configuration for the run history UI.
    const configSnapshot = await buildRunConfigSnapshot(effectiveConfig);

    // If any pre-flight step throws (createPipelineRun included), the outer
    // finally still releases the slot — a leak would permanently brick all
    // future runs once maxConcurrentPipelines failures accumulate.
    const pipelineRun = await pipelineRepo.createPipelineRun(configSnapshot);
    pipelineRunId = pipelineRun.id;
    userActiveRuns.delete(pendingId);
    userActiveRuns.add(pipelineRun.id);

    return await runWithRequestContext(
      {
        userId,
        requestId: getRequestId() ?? randomUUID(),
        pipelineRunId: pipelineRun.id,
      },
      async () => {
        const pipelineLogger = logger.child({
          pipelineRunId: pipelineRun.id,
          userId,
        });
        let jobsDiscovered = 0;
        let jobsProcessed = 0;
        pipelineLogger.info("Starting pipeline run", {
          topN: effectiveConfig.topN,
          minSuitabilityScore: effectiveConfig.minSuitabilityScore,
          sources: effectiveConfig.sources,
          excludeRunIds,
          activeRunCount: userActiveRuns?.size ?? 1,
        });

        const stepStartTimes = new Map<string, number>();
        const startStep = (name: string): void => {
          stepStartTimes.set(name, Date.now());
          pipelineLogger.debug("Pipeline step started", { step: name });
        };
        const finishStep = (
          name: string,
          extra: Record<string, unknown> = {},
        ): void => {
          pipelineLogger.debug("Pipeline step completed", {
            step: name,
            durationMs: Date.now() - (stepStartTimes.get(name) ?? Date.now()),
            ...extra,
          });
        };

        try {
          ensureNotCancelled(pipelineRun.id, userId);
          startStep("load-profile");
          const profile = await loadProfileStep();
          finishStep("load-profile");

          ensureNotCancelled(pipelineRun.id, userId);
          startStep("discover-jobs");
          const { discoveredJobs } = await discoverJobsStep({
            mergedConfig: effectiveConfig,
            shouldCancel: () => cancelRequestedByRunId.has(pipelineRun.id),
          });
          finishStep("discover-jobs", { discovered: discoveredJobs.length });

          ensureNotCancelled(pipelineRun.id, userId);
          startStep("import-jobs");
          const { created } = await importJobsStep({
            discoveredJobs,
            runId: pipelineRun.id,
          });
          jobsDiscovered = created;
          finishStep("import-jobs", { created });

          await pipelineRepo.updatePipelineRun(pipelineRun.id, {
            jobsDiscovered: created,
          });

          ensureNotCancelled(pipelineRun.id, userId);
          startStep("score-jobs");
          const { unprocessedJobs, scoredJobs } = await scoreJobsStep({
            profile,
            excludeRunIds,
            shouldCancel: () => cancelRequestedByRunId.has(pipelineRun.id),
          });
          finishStep("score-jobs", {
            scored: scoredJobs.length,
            unprocessed: unprocessedJobs.length,
          });

          ensureNotCancelled(pipelineRun.id, userId);
          startStep("select-jobs");
          const jobsToProcess = selectJobsStep({
            scoredJobs,
            mergedConfig: effectiveConfig,
          });
          finishStep("select-jobs", { selected: jobsToProcess.length });

          ensureNotCancelled(pipelineRun.id, userId);
          startStep("process-jobs");
          const { processedCount } = await processJobsStep({
            jobsToProcess,
            processJob,
            shouldCancel: () => cancelRequestedByRunId.has(pipelineRun.id),
          });
          jobsProcessed = processedCount;
          finishStep("process-jobs", { processed: processedCount });

          await pipelineRepo.updatePipelineRun(pipelineRun.id, {
            status: "completed",
            completedAt: new Date().toISOString(),
            jobsProcessed,
          });

          progressHelpers.complete(jobsDiscovered, jobsProcessed, userId);
          pipelineLogger.info("Pipeline run completed", {
            jobsDiscovered,
            jobsProcessed,
          });

          await notifyPipelineWebhookStep("pipeline.completed", {
            pipelineRunId: pipelineRun.id,
            jobsDiscovered,
            jobsProcessed,
          });

          return { success: true, jobsDiscovered, jobsProcessed };
        } catch (error) {
          if (error instanceof PipelineCancelledError) {
            const reason = error.message || "Pipeline cancellation requested";
            await pipelineRepo.updatePipelineRun(pipelineRun.id, {
              status: "cancelled",
              completedAt: new Date().toISOString(),
              errorMessage: reason,
            });

            progressHelpers.cancelled(reason, userId);
            pipelineLogger.warn("Pipeline run cancelled", {
              reason,
              jobsDiscovered,
              jobsProcessed,
            });

            await notifyPipelineWebhookStep("pipeline.cancelled", {
              pipelineRunId: pipelineRun.id,
              reason,
            });

            return {
              success: false,
              jobsDiscovered,
              jobsProcessed,
              error: reason,
            };
          }

          const message =
            error instanceof Error ? error.message : "Unknown error";

          await pipelineRepo.updatePipelineRun(pipelineRun.id, {
            status: "failed",
            completedAt: new Date().toISOString(),
            errorMessage: message,
          });

          progressHelpers.failed(message, userId);
          pipelineLogger.error("Pipeline run failed", error);

          await notifyPipelineWebhookStep("pipeline.failed", {
            pipelineRunId: pipelineRun.id,
            error: message,
          });

          return {
            success: false,
            jobsDiscovered,
            jobsProcessed,
            error: message,
          };
        }
      },
    );
  } finally {
    if (pipelineRunId) {
      userActiveRuns?.delete(pipelineRunId);
      cancelRequestedByRunId.delete(pipelineRunId);
    }
    userActiveRuns?.delete(pendingId);
    if (userActiveRuns && userActiveRuns.size === 0) {
      activeRunIdsByUserId.delete(userId);
      cancelAllByUserId.delete(userId);
    }
  }
}

export type ProcessJobOptions = {
  force?: boolean;
  requestOrigin?: string | null;
  analyticsOrigin?:
    | "move_to_ready"
    | "generate_pdf"
    | "pipeline"
    | "manual_job_create";
};

/**
 * Step 1: Generate AI summary and suggest projects.
 */
export async function summarizeJob(
  jobId: string,
  options?: ProcessJobOptions,
): Promise<{
  success: boolean;
  error?: string;
}> {
  return runWithRequestContext({ jobId }, async () => {
    const jobLogger = logger.child({ jobId });
    jobLogger.info("Summarizing job");
    try {
      const job = await jobsRepo.getJobById(jobId);
      if (!job) return { success: false, error: "Job not found" };

      const profile = await getProfile().catch(() => ({}) as ResumeProfile);

      // 1. Generate Summary & Tailoring
      let tailoredSummary = job.tailoredSummary;
      let tailoredHeadline = job.tailoredHeadline;
      let tailoredSkills = job.tailoredSkills;
      let tailoredExperienceBullets = job.tailoredExperienceBullets;

      if (!tailoredSummary || !tailoredHeadline || options?.force) {
        jobLogger.info("Generating tailoring content");
        const tailoringResult = await generateTailoring(
          job.jobDescription || "",
          profile,
        );
        if (tailoringResult.success && tailoringResult.data) {
          tailoredSummary = tailoringResult.data.summary;
          tailoredHeadline = tailoringResult.data.headline;
          tailoredSkills = JSON.stringify(tailoringResult.data.skills);
          tailoredExperienceBullets = tailoringResult.data.experienceBullets
            ? JSON.stringify(tailoringResult.data.experienceBullets)
            : null;
        } else if (options?.force || !tailoredSummary || !tailoredHeadline) {
          return {
            success: false,
            error: `Tailoring failed: ${tailoringResult.error || "unknown error"}`,
          };
        }
      }

      // 2. Suggest Projects
      let selectedProjectIds = job.selectedProjectIds;
      if (!selectedProjectIds || options?.force) {
        jobLogger.info("Selecting projects");
        try {
          const { catalog, selectionItems } =
            extractProjectsFromProfile(profile);
          const overrideResumeProjectsRaw = await getSetting("resumeProjects");
          const { resumeProjects } = resolveResumeProjectsSettings({
            catalog,
            overrideRaw: overrideResumeProjectsRaw,
          });

          const locked = resumeProjects.lockedProjectIds;
          const desiredCount = Math.max(
            0,
            resumeProjects.maxProjects - locked.length,
          );
          const eligibleSet = new Set(resumeProjects.aiSelectableProjectIds);
          const eligibleProjects = selectionItems.filter((p) =>
            eligibleSet.has(p.id),
          );

          const picked = await pickProjectIdsForJob({
            jobDescription: job.jobDescription || "",
            eligibleProjects,
            desiredCount,
          });

          selectedProjectIds = [...locked, ...picked].join(",");
        } catch (error) {
          jobLogger.warn("Failed to suggest projects", error);
        }
      }

      await jobsRepo.updateJob(job.id, {
        tailoredSummary: tailoredSummary ?? undefined,
        tailoredHeadline: tailoredHeadline ?? undefined,
        tailoredSkills: tailoredSkills ?? undefined,
        tailoredExperienceBullets: tailoredExperienceBullets ?? undefined,
        selectedProjectIds: selectedProjectIds ?? undefined,
      });

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      jobLogger.error("Summarization failed", error);
      return { success: false, error: message };
    }
  });
}

/**
 * Step 2: Generate PDF using current summary and project selection.
 */
export async function generateFinalPdf(
  jobId: string,
  options?: ProcessJobOptions,
): Promise<{
  success: boolean;
  error?: string;
}> {
  return runWithRequestContext({ jobId }, async () => {
    const jobLogger = logger.child({ jobId });
    jobLogger.info("Generating final PDF");
    try {
      const job = await jobsRepo.getJobById(jobId);
      if (!job) return { success: false, error: "Job not found" };

      // Mark as processing
      await jobsRepo.updateJob(job.id, { status: "processing" });

      const pdfResult = await generatePdf(
        job.id,
        {
          summary: job.tailoredSummary || "",
          headline: job.tailoredHeadline || "",
          skills: safeParseSkills(job.tailoredSkills),
          experienceBullets: safeParseExperienceBullets(
            job.tailoredExperienceBullets,
          ),
        },
        job.jobDescription || "",
        undefined, // deprecated baseResumePath parameter
        job.selectedProjectIds,
        {
          tracerLinksEnabled: job.tracerLinksEnabled,
          requestOrigin: options?.requestOrigin ?? null,
          tracerCompanyName: job.employer ?? null,
        },
      );

      if (!pdfResult.success) {
        // Revert status if failed
        await jobsRepo.updateJob(job.id, { status: "discovered" });
        return { success: false, error: pdfResult.error };
      }

      await jobsRepo.updateJob(job.id, {
        status: "ready",
        pdfPath: pdfResult.pdfPath,
      });

      const analyticsOrigin = options?.analyticsOrigin ?? "move_to_ready";
      const generationKind = job.status === "ready" ? "regenerate" : "initial";
      void trackServerProductEvent(
        "resume_generated",
        {
          origin: analyticsOrigin,
          generation_kind: generationKind,
          tracer_links_enabled: job.tracerLinksEnabled,
          has_tailored_summary: Boolean(job.tailoredSummary),
          has_tailored_skills: Boolean(job.tailoredSkills),
        },
        {
          requestOrigin: options?.requestOrigin ?? null,
          urlPath: "/jobs",
        },
      );

      if (job.status !== "ready") {
        void trackServerProductEvent(
          "job_moved_to_ready",
          {
            origin: analyticsOrigin,
            tracer_links_enabled: job.tracerLinksEnabled,
          },
          {
            requestOrigin: options?.requestOrigin ?? null,
            urlPath: "/jobs",
          },
        );
      }

      return { success: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      jobLogger.error("PDF generation failed", error);
      return { success: false, error: message };
    }
  });
}

/**
 * Process a single job (runs both steps in sequence).
 */
export async function processJob(
  jobId: string,
  options?: ProcessJobOptions,
): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    // Step 1: Summarize & Select Projects
    const sumResult = await summarizeJob(jobId, options);
    if (!sumResult.success) return sumResult;

    // Step 2: Generate PDF
    const pdfResult = await generateFinalPdf(jobId, options);
    return pdfResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return { success: false, error: message };
  }
}

/**
 * Check if pipeline is currently running for a user.
 */
export function getPipelineStatus(explicitUserId?: string): {
  isRunning: boolean;
  activeRunCount: number;
  maxConcurrentRuns: number;
} {
  const userId = resolveUser(explicitUserId);
  const userActiveRuns = activeRunIdsByUserId.get(userId);
  const count = userActiveRuns?.size ?? 0;
  return {
    isRunning: count > 0,
    activeRunCount: count,
    maxConcurrentRuns: maxConcurrentPipelinesPerUser,
  };
}

/** Set the max concurrent pipeline runs per user. */
export function setMaxConcurrentPipelines(max: number): void {
  maxConcurrentPipelinesPerUser = Math.min(5, Math.max(1, max));
}

export function requestPipelineCancel(
  pipelineRunId?: string,
  explicitUserId?: string,
): {
  accepted: boolean;
  pipelineRunId: string | null;
  alreadyRequested: boolean;
} {
  const userId = resolveUser(explicitUserId);
  const userActiveRuns = activeRunIdsByUserId.get(userId);
  if (!userActiveRuns || userActiveRuns.size === 0) {
    return { accepted: false, pipelineRunId: null, alreadyRequested: false };
  }

  // If a specific run id is provided, cancel just that run.
  if (pipelineRunId) {
    if (!userActiveRuns.has(pipelineRunId)) {
      return { accepted: false, pipelineRunId: null, alreadyRequested: false };
    }
    if (cancelRequestedByRunId.has(pipelineRunId)) {
      return {
        accepted: true,
        pipelineRunId,
        alreadyRequested: true,
      };
    }
    cancelRequestedByRunId.add(pipelineRunId);
    return {
      accepted: true,
      pipelineRunId,
      alreadyRequested: false,
    };
  }

  // No id: cancel every active run for this user
  const mostRecentId =
    [...userActiveRuns].filter((id) => !id.startsWith("pending")).at(-1) ??
    null;
  if (cancelAllByUserId.get(userId)) {
    return {
      accepted: true,
      pipelineRunId: mostRecentId,
      alreadyRequested: true,
    };
  }
  cancelAllByUserId.set(userId, true);
  for (const id of userActiveRuns) {
    cancelRequestedByRunId.add(id);
  }
  return {
    accepted: true,
    pipelineRunId: mostRecentId,
    alreadyRequested: false,
  };
}

export function isPipelineCancelRequested(explicitUserId?: string): boolean {
  const userId = resolveUser(explicitUserId);
  return (
    Boolean(cancelAllByUserId.get(userId)) || cancelRequestedByRunId.size > 0
  );
}

export function __resetPipelineOrchestratorForTests(): void {
  activeRunIdsByUserId.clear();
  cancelRequestedByRunId.clear();
  cancelAllByUserId.clear();
}
