/**
 * Pipeline schedules repository — CRUD for the `pipeline_schedules` table.
 *
 * Each row represents an independent daily scheduled pipeline run with its own
 * hour, enabled flag, sources, and optional advanced config (search terms,
 * country, cities, workplace types, topN, minSuitabilityScore).
 */

import { randomUUID } from "node:crypto";
import { getCurrentUserId } from "@infra/request-context";
import type { ExtractorSourceId } from "@shared/extractors";
import type { PipelineSchedule } from "@shared/types";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const { pipelineSchedules } = schema;

function currentUserId(): string {
  return getCurrentUserId();
}

/** Parse a JSON column value into a string array (or null). */
function parseJsonArray(raw: string | null): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

/** Serialize a string array (or null/undefined) into a JSON column value. */
function serializeJsonArray(value: string[] | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
}

/** Serialize an optional string (or null/undefined) for a TEXT column. */
function serializeOptionalString(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

interface ScheduleRow {
  id: string;
  userId: string;
  label: string;
  enabled: number;
  hour: number;
  sources: string;
  searchTerms: string | null;
  country: string | null;
  cityLocations: string | null;
  workplaceTypes: string | null;
  topN: number | null;
  minSuitabilityScore: number | null;
  createdAt: string;
  updatedAt: string;
}

function mapRowToSchedule(
  row: ScheduleRow,
): PipelineSchedule & { userId: string } {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    enabled: row.enabled === 1,
    hour: row.hour,
    sources: (parseJsonArray(row.sources) ?? []) as ExtractorSourceId[],
    searchTerms: parseJsonArray(row.searchTerms),
    country: row.country,
    cityLocations: parseJsonArray(row.cityLocations),
    workplaceTypes: parseJsonArray(row.workplaceTypes),
    topN: row.topN,
    minSuitabilityScore: row.minSuitabilityScore,
    nextRun: null,
  };
}

/** Attach the computed nextRun timestamp to a schedule object. */
export function withNextRun(
  schedule: PipelineSchedule,
  nextRun: string | null,
): PipelineSchedule {
  return { ...schedule, nextRun };
}

/**
 * List all pipeline schedules for the user, ordered by creation order (oldest first).
 */
export async function listPipelineSchedules(
  userId: string = currentUserId(),
): Promise<PipelineSchedule[]> {
  const rows = await db
    .select()
    .from(pipelineSchedules)
    .where(eq(pipelineSchedules.userId, userId))
    .orderBy(desc(pipelineSchedules.createdAt));

  return rows.map((row) => mapRowToSchedule(row as unknown as ScheduleRow));
}

/**
 * Get a single pipeline schedule by id.
 */
export async function getPipelineScheduleById(
  id: string,
  userId: string = currentUserId(),
): Promise<PipelineSchedule | null> {
  const [row] = await db
    .select()
    .from(pipelineSchedules)
    .where(
      and(eq(pipelineSchedules.id, id), eq(pipelineSchedules.userId, userId)),
    )
    .limit(1);

  if (!row) return null;
  return mapRowToSchedule(row as unknown as ScheduleRow);
}

export interface CreateScheduleInput {
  label: string;
  enabled?: boolean;
  hour: number;
  sources: ExtractorSourceId[];
  searchTerms?: string[] | null;
  country?: string | null;
  cityLocations?: string[] | null;
  workplaceTypes?: string[] | null;
  topN?: number | null;
  minSuitabilityScore?: number | null;
}

/**
 * Create a new pipeline schedule row.
 */
export async function createPipelineSchedule(
  input: CreateScheduleInput,
  userId: string = currentUserId(),
): Promise<PipelineSchedule> {
  const id = randomUUID();
  const now = new Date().toISOString();

  const values = {
    id,
    userId,
    label: input.label,
    enabled: input.enabled ? 1 : 0,
    hour: input.hour,
    sources: JSON.stringify(input.sources),
    searchTerms: serializeJsonArray(input.searchTerms),
    country: serializeOptionalString(input.country),
    cityLocations: serializeJsonArray(input.cityLocations),
    workplaceTypes: serializeJsonArray(input.workplaceTypes),
    topN: input.topN ?? null,
    minSuitabilityScore: input.minSuitabilityScore ?? null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(pipelineSchedules).values(values);

  return mapRowToSchedule({ ...values, enabled: values.enabled });
}

export type UpdateScheduleInput = Partial<CreateScheduleInput>;

/**
 * Update an existing pipeline schedule. Only provided fields are changed.
 */
export async function updatePipelineSchedule(
  id: string,
  input: UpdateScheduleInput,
  userId: string = currentUserId(),
): Promise<PipelineSchedule | null> {
  const update: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.label !== undefined) update.label = input.label;
  if (input.enabled !== undefined) update.enabled = input.enabled ? 1 : 0;
  if (input.hour !== undefined) update.hour = input.hour;
  if (input.sources !== undefined)
    update.sources = JSON.stringify(input.sources);
  if (input.searchTerms !== undefined)
    update.searchTerms = serializeJsonArray(input.searchTerms);
  if (input.country !== undefined)
    update.country = serializeOptionalString(input.country);
  if (input.cityLocations !== undefined)
    update.cityLocations = serializeJsonArray(input.cityLocations);
  if (input.workplaceTypes !== undefined)
    update.workplaceTypes = serializeJsonArray(input.workplaceTypes);
  if (input.topN !== undefined) update.topN = input.topN;
  if (input.minSuitabilityScore !== undefined)
    update.minSuitabilityScore = input.minSuitabilityScore;

  const [row] = await db
    .update(pipelineSchedules)
    .set(update)
    .where(
      and(eq(pipelineSchedules.id, id), eq(pipelineSchedules.userId, userId)),
    )
    .returning();

  if (!row) return null;
  return mapRowToSchedule(row as unknown as ScheduleRow);
}

/**
 * Delete a pipeline schedule by id.
 */
export async function deletePipelineSchedule(
  id: string,
  userId: string = currentUserId(),
): Promise<boolean> {
  const result = await db
    .delete(pipelineSchedules)
    .where(
      and(eq(pipelineSchedules.id, id), eq(pipelineSchedules.userId, userId)),
    )
    .returning({ id: pipelineSchedules.id });

  return result.length > 0;
}

/**
 * Get all enabled pipeline schedules across all users (used by the background
 * scheduler to build timer instances).
 */
export async function getEnabledSchedules(): Promise<
  Array<PipelineSchedule & { userId: string }>
> {
  const rows = await db
    .select()
    .from(pipelineSchedules)
    .where(eq(pipelineSchedules.enabled, 1))
    .orderBy(desc(pipelineSchedules.createdAt));

  return rows.map((row) => mapRowToSchedule(row as unknown as ScheduleRow));
}
