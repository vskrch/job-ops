/**
 * Search schedules repository — CRUD for the `search_schedules` table.
 *
 * Each row represents a recurring NL job search schedule with its own
 * frequency (hourly or daily), enabled flag, query text, and notification
 * preferences.
 */

import { randomUUID } from "node:crypto";
import { getCurrentUserId } from "@infra/request-context";
import type {
  CreateSearchScheduleInput,
  SearchSchedule,
  SearchScheduleFrequency,
  UpdateSearchScheduleInput,
} from "@shared/types";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const { searchSchedules } = schema;

function currentUserId(): string {
  return getCurrentUserId();
}

interface SearchScheduleRow {
  id: string;
  userId: string;
  label: string;
  enabled: number;
  frequency: string;
  hour: number | null;
  minute: number;
  query: string;
  notifyEmail: number;
  notifyWebhook: number;
  lastRunAt: string | null;
  lastSearchId: string | null;
  lastResultsCount: number | null;
  createdAt: string;
  updatedAt: string;
}

function mapRowToSchedule(
  row: SearchScheduleRow,
): SearchSchedule & { userId: string } {
  return {
    id: row.id,
    userId: row.userId,
    label: row.label,
    enabled: row.enabled === 1,
    frequency: row.frequency as SearchScheduleFrequency,
    hour: row.hour,
    minute: row.minute,
    query: row.query,
    notifyEmail: row.notifyEmail === 1,
    notifyWebhook: row.notifyWebhook === 1,
    lastRunAt: row.lastRunAt,
    lastSearchId: row.lastSearchId,
    lastResultsCount: row.lastResultsCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    nextRun: null,
  };
}

/**
 * List all search schedules for the user, ordered by creation order (newest first).
 */
export async function listSearchSchedules(
  userId: string = currentUserId(),
): Promise<SearchSchedule[]> {
  const rows = await db
    .select()
    .from(searchSchedules)
    .where(eq(searchSchedules.userId, userId))
    .orderBy(desc(searchSchedules.createdAt));

  return rows.map((row) =>
    mapRowToSchedule(row as unknown as SearchScheduleRow),
  );
}

/**
 * Get a single search schedule by id.
 */
export async function getSearchScheduleById(
  id: string,
  userId: string = currentUserId(),
): Promise<SearchSchedule | null> {
  const [row] = await db
    .select()
    .from(searchSchedules)
    .where(and(eq(searchSchedules.id, id), eq(searchSchedules.userId, userId)))
    .limit(1);

  if (!row) return null;
  return mapRowToSchedule(row as unknown as SearchScheduleRow);
}

/**
 * Create a new search schedule row.
 */
export async function createSearchSchedule(
  input: CreateSearchScheduleInput,
  userId: string = currentUserId(),
): Promise<SearchSchedule> {
  const id = randomUUID();
  const now = new Date().toISOString();

  const frequency: SearchScheduleFrequency = input.frequency ?? "daily";
  const hour =
    input.hour !== undefined ? input.hour : frequency === "daily" ? 2 : null;

  const values = {
    id,
    userId,
    label: input.label,
    enabled: (input.enabled ?? true) ? 1 : 0,
    frequency,
    hour,
    minute: input.minute ?? 0,
    query: input.query,
    notifyEmail: (input.notifyEmail ?? true) ? 1 : 0,
    notifyWebhook: (input.notifyWebhook ?? true) ? 1 : 0,
    lastRunAt: null,
    lastSearchId: null,
    lastResultsCount: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.insert(searchSchedules).values(values);

  return mapRowToSchedule({ ...values, enabled: values.enabled });
}

/**
 * Update an existing search schedule. Only provided fields are changed.
 */
export async function updateSearchSchedule(
  id: string,
  input: UpdateSearchScheduleInput,
  userId: string = currentUserId(),
): Promise<SearchSchedule | null> {
  const update: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };

  if (input.label !== undefined) update.label = input.label;
  if (input.enabled !== undefined) update.enabled = input.enabled ? 1 : 0;
  if (input.frequency !== undefined) {
    update.frequency = input.frequency;
    // When switching to hourly, clear the hour; when switching to daily and
    // no hour is provided, default to 2.
    if (input.frequency === "hourly") {
      update.hour = null;
    } else if (input.frequency === "daily" && input.hour === undefined) {
      update.hour = 2;
    }
  }
  if (input.hour !== undefined) update.hour = input.hour;
  if (input.minute !== undefined) update.minute = input.minute;
  if (input.query !== undefined) update.query = input.query;
  if (input.notifyEmail !== undefined)
    update.notifyEmail = input.notifyEmail ? 1 : 0;
  if (input.notifyWebhook !== undefined)
    update.notifyWebhook = input.notifyWebhook ? 1 : 0;

  const [row] = await db
    .update(searchSchedules)
    .set(update)
    .where(and(eq(searchSchedules.id, id), eq(searchSchedules.userId, userId)))
    .returning();

  if (!row) return null;
  return mapRowToSchedule(row as unknown as SearchScheduleRow);
}

/**
 * Delete a search schedule by id.
 */
export async function deleteSearchSchedule(
  id: string,
  userId: string = currentUserId(),
): Promise<boolean> {
  const result = await db
    .delete(searchSchedules)
    .where(and(eq(searchSchedules.id, id), eq(searchSchedules.userId, userId)))
    .returning({ id: searchSchedules.id });

  return result.length > 0;
}

/**
 * Get all enabled search schedules across all users (used by the background scheduler
 * to build timer instances).
 */
export async function getEnabledSearchSchedules(): Promise<
  Array<SearchSchedule & { userId: string }>
> {
  const rows = await db
    .select()
    .from(searchSchedules)
    .where(eq(searchSchedules.enabled, 1))
    .orderBy(desc(searchSchedules.createdAt));

  return rows.map((row) =>
    mapRowToSchedule(row as unknown as SearchScheduleRow),
  );
}

/**
 * Update a schedule's last-run metadata after a scheduled or manual run.
 */
export async function updateScheduleRunResult(
  id: string,
  searchId: string | null,
  resultsCount: number | null,
  runAt: string,
): Promise<void> {
  await db
    .update(searchSchedules)
    .set({
      lastRunAt: runAt,
      lastSearchId: searchId,
      lastResultsCount: resultsCount,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(searchSchedules.id, id));
}
