/**
 * Main pipeline logic - orchestrates the daily job processing flow.
 *
 * Flow:
 * 1. Run crawler to discover new jobs
 * 2. Score jobs for suitability
 * 3. Leave all jobs in "discovered" for manual processing
 */

import { join } from "node:path";
import { logger } from "@infra/logger";
import { trackServerProductEvent } from "@infra/product-analytics";
import { runWithRequestContext } from "@infra/request-context";
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

// ponytail: module-level counting semaphore — single-process only.
// SQLite + better-sqlite3 is single-connection; this is fine until horizontal
// scaling. Up to `maxConcurrentPipelines` runs can execute simultaneously.
// Upgrade path: move to a DB-backed advisory lock (pipeline_runs row) if
// multi-instance.
let activePipelineRuns = 0;
let maxConcurrentPipelines = 3;
const activeRunIds = new Set<string>();
const cancelRequestedByRunId = new Set<string>();
let cancelAllRequested = false;

class PipelineCancelledError extends Error {
  constructor(message = "Pipeline cancellation requested") {
    super(message);
    this.name = "PipelineCancelledError";
  }
}

function ensureNotCancelled(runId: string): void {
  if (cancelAllRequested || cancelRequestedByRunId.has(runId)) {
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
): Promise<{
  success: boolean;
  jobsDiscovered: number;
  jobsProcessed: number;
  error?: string;
}> {
  if (activePipelineRuns >= maxConcurrentPipelines) {
    return {
      success: false,
      jobsDiscovered: 0,
      jobsProcessed: 0,
      error: `Pipeline concurrency limit reached (${activePipelineRuns} running). Try again shortly.`,
    };
  }

  activePipelineRuns++;
  let pipelineRunId = "pending";
  activeRunIds.add(pipelineRunId);
  resetProgress();
  const mergedConfig = { ...DEFAULT_CONFIG, ...config };

  // Resolve excluded runs from the persisted setting (set via Run > Advanced).
  const excludeRunIds = await resolveExcludeRunIds();
  const effectiveConfig: PipelineConfig = {
    ...mergedConfig,
    excludeRunIds,
  };

  // Snapshot the effective run configuration for the run history UI.
  const configSnapshot = await buildRunConfigSnapshot(effectiveConfig);

  const pipelineRun = await pipelineRepo.createPipelineRun(configSnapshot);
  pipelineRunId = pipelineRun.id;
  activeRunIds.delete("pending");
  activeRunIds.add(pipelineRun.id);

  return runWithRequestContext({ pipelineRunId: pipelineRun.id }, async () => {
    const pipelineLogger = logger.child({ pipelineRunId: pipelineRun.id });
    let jobsDiscovered = 0;
    let jobsProcessed = 0;
    pipelineLogger.info("Starting pipeline run", {
      topN: effectiveConfig.topN,
      minSuitabilityScore: effectiveConfig.minSuitabilityScore,
      sources: effectiveConfig.sources,
      excludeRunIds,
      activeRunCount: activePipelineRuns,
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
      ensureNotCancelled(pipelineRun.id);
      startStep("load-profile");
      const profile = await loadProfileStep();
      finishStep("load-profile");

      ensureNotCancelled(pipelineRun.id);
      startStep("discover-jobs");
      const { discoveredJobs } = await discoverJobsStep({
        mergedConfig: effectiveConfig,
        shouldCancel: () => cancelRequestedByRunId.has(pipelineRun.id),
      });
      finishStep("discover-jobs", { discovered: discoveredJobs.length });

      ensureNotCancelled(pipelineRun.id);
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

      ensureNotCancelled(pipelineRun.id);
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

      ensureNotCancelled(pipelineRun.id);
      startStep("select-jobs");
      const jobsToProcess = selectJobsStep({
        scoredJobs,
        mergedConfig: effectiveConfig,
      });
      finishStep("select-jobs", { selected: jobsToProcess.length });

      pipelineLogger.info("Selected jobs for processing", {
        candidates: jobsToProcess.length,
      });

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
        jobsProcessed: processedCount,
      });

      progressHelpers.complete(created, processedCount);
      pipelineLogger.info("Pipeline run completed", {
        jobsDiscovered: created,
        jobsProcessed: processedCount,
      });

      await notifyPipelineWebhookStep("pipeline.completed", {
        pipelineRunId: pipelineRun.id,
        jobsDiscovered: created,
        jobsScored: unprocessedJobs.length,
        jobsProcessed: processedCount,
      });

      return {
        success: true,
        jobsDiscovered: created,
        jobsProcessed: processedCount,
      };
    } catch (error) {
      if (error instanceof PipelineCancelledError) {
        const message = "Cancelled by user request";
        await pipelineRepo.updatePipelineRun(pipelineRun.id, {
          status: "cancelled",
          completedAt: new Date().toISOString(),
          jobsDiscovered,
          jobsProcessed,
          errorMessage: message,
        });
        progressHelpers.cancelled(message);
        pipelineLogger.info("Pipeline run cancelled", {
          jobsDiscovered,
          jobsProcessed,
        });
        return {
          success: false,
          jobsDiscovered,
          jobsProcessed,
          error: message,
        };
      }

      const message = error instanceof Error ? error.message : "Unknown error";

      await pipelineRepo.updatePipelineRun(pipelineRun.id, {
        status: "failed",
        completedAt: new Date().toISOString(),
        errorMessage: message,
      });

      progressHelpers.failed(message);
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
    } finally {
      activePipelineRuns = Math.max(0, activePipelineRuns - 1);
      activeRunIds.delete(pipelineRun.id);
      cancelRequestedByRunId.delete(pipelineRun.id);
      // Reset the global "cancel all" flag once the last active run finishes.
      if (activePipelineRuns === 0) {
        cancelAllRequested = false;
      }
    }
  });
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
 * Check if pipeline is currently running.
 */
export function getPipelineStatus(): {
  isRunning: boolean;
  activeRunCount: number;
  maxConcurrentRuns: number;
} {
  return {
    isRunning: activePipelineRuns > 0,
    activeRunCount: activePipelineRuns,
    maxConcurrentRuns: maxConcurrentPipelines,
  };
}

/** Set the max concurrent pipeline runs (called from the settings service). */
export function setMaxConcurrentPipelines(max: number): void {
  maxConcurrentPipelines = Math.min(5, Math.max(1, max));
}

export function requestPipelineCancel(pipelineRunId?: string): {
  accepted: boolean;
  pipelineRunId: string | null;
  alreadyRequested: boolean;
} {
  if (activePipelineRuns === 0) {
    return { accepted: false, pipelineRunId: null, alreadyRequested: false };
  }

  // If a specific run id is provided, cancel just that run.
  if (pipelineRunId) {
    if (!activeRunIds.has(pipelineRunId)) {
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

  // No id: cancel every active run (restores the pre-concurrency "cancel all"
  // behavior). The run may still be in the "pending" phase (createPipelineRun
  // not yet resolved), so a global flag covers that window.
  const mostRecentId =
    [...activeRunIds].filter((id) => id !== "pending").at(-1) ?? null;
  if (cancelAllRequested) {
    return {
      accepted: true,
      pipelineRunId: mostRecentId,
      alreadyRequested: true,
    };
  }
  cancelAllRequested = true;
  for (const id of activeRunIds) {
    cancelRequestedByRunId.add(id);
  }
  return {
    accepted: true,
    pipelineRunId: mostRecentId,
    alreadyRequested: false,
  };
}

export function isPipelineCancelRequested(): boolean {
  return cancelAllRequested || cancelRequestedByRunId.size > 0;
}
