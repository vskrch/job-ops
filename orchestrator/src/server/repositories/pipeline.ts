/**
 * Pipeline run repository.
 */

import { randomUUID } from "node:crypto";
import { getCurrentUserId } from "@infra/request-context";
import type { PipelineRun, PipelineRunConfigSnapshot } from "@shared/types";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index";

const { pipelineRuns } = schema;

/** Resolve the owning user for the current request/flow. */
function currentUserId(): string {
  return getCurrentUserId();
}

function parseConfig(raw: string | null): PipelineRunConfigSnapshot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PipelineRunConfigSnapshot;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.sources)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function mapRowToPipelineRun(row: {
  id: string;
  startedAt: string;
  completedAt: string | null;
  status: string;
  jobsDiscovered: number;
  jobsProcessed: number;
  errorMessage: string | null;
  config: string | null;
}): PipelineRun {
  return {
    id: row.id,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    status: row.status as PipelineRun["status"],
    jobsDiscovered: row.jobsDiscovered,
    jobsProcessed: row.jobsProcessed,
    errorMessage: row.errorMessage,
    config: parseConfig(row.config),
  };
}

/**
 * Create a new pipeline run.
 */
export async function createPipelineRun(
  config?: PipelineRunConfigSnapshot,
): Promise<PipelineRun> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const userId = currentUserId();

  await db.insert(pipelineRuns).values({
    id,
    userId,
    startedAt: now,
    status: "running",
    config: config ? JSON.stringify(config) : null,
  });

  return {
    id,
    startedAt: now,
    completedAt: null,
    status: "running",
    jobsDiscovered: 0,
    jobsProcessed: 0,
    errorMessage: null,
    config: config ?? null,
  };
}

/**
 * Update a pipeline run.
 */
export async function updatePipelineRun(
  id: string,
  update: Partial<{
    completedAt: string;
    status: "running" | "completed" | "failed" | "cancelled";
    jobsDiscovered: number;
    jobsProcessed: number;
    errorMessage: string;
  }>,
): Promise<void> {
  await db
    .update(pipelineRuns)
    .set(update)
    .where(
      and(eq(pipelineRuns.id, id), eq(pipelineRuns.userId, currentUserId())),
    );
}

/**
 * Get the latest pipeline run.
 */
export async function getLatestPipelineRun(): Promise<PipelineRun | null> {
  const [row] = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.userId, currentUserId()))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(1);

  if (!row) return null;

  return mapRowToPipelineRun(row);
}

/**
 * Get a single pipeline run by id.
 */
export async function getPipelineRun(id: string): Promise<PipelineRun | null> {
  const [row] = await db
    .select()
    .from(pipelineRuns)
    .where(
      and(eq(pipelineRuns.id, id), eq(pipelineRuns.userId, currentUserId())),
    )
    .limit(1);

  if (!row) return null;

  return mapRowToPipelineRun(row);
}

/**
 * Get recent pipeline runs.
 */
export async function getRecentPipelineRuns(
  limit: number = 10,
): Promise<PipelineRun[]> {
  const rows = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.userId, currentUserId()))
    .orderBy(desc(pipelineRuns.startedAt))
    .limit(limit);

  return rows.map(mapRowToPipelineRun);
}

/**
 * Mark any runs left in "running" state as "failed" — call once at boot to
 * recover from unclean shutdowns (crash, SIGKILL, power loss).
 */
export async function markOrphanedRunsAsFailed(): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .update(pipelineRuns)
    .set({
      status: "failed",
      completedAt: now,
      errorMessage: "Run interrupted by server restart",
    })
    .where(inArray(pipelineRuns.status, ["running"]))
    .returning({ id: pipelineRuns.id });

  return result.length;
}
