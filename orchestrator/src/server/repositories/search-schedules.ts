/**
 * Search schedules repository — CRUD for the `search_schedules` table.
 *
 * Each row represents a recurring NL job search schedule with its own
 * frequency (hourly or daily), enabled flag, query text, and notification
 * preferences.
 */

import { randomUUID } from "node:crypto";
import type {
  CreateSearchScheduleInput,
  SearchSchedule,
  SearchScheduleFrequency,
  UpdateSearchScheduleInput,
} from "@shared/types";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const { searchSchedules } = schema;

interface SearchScheduleRow {
  id: string;
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

function mapRowToSchedule(row: SearchScheduleRow): SearchSchedule {
  return {
    id: row.id,
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
 * List all search schedules, ordered by creation order (newest first).
 */
export async function listSearchSchedules(): Promise<SearchSchedule[]> {
  const rows = await db
    .select()
    .from(searchSchedules)
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
): Promise<SearchSchedule | null> {
  const [row] = await db
    .select()
    .from(searchSchedules)
    .where(eq(searchSchedules.id, id))
    .limit(1);

  if (!row) return null;
  return mapRowToSchedule(row as unknown as SearchScheduleRow);
}

/**
 * Create a new search schedule row.
 */
export async function createSearchSchedule(
  input: CreateSearchScheduleInput,
): Promise<SearchSchedule> {
  const id = randomUUID();
  const now = new Date().toISOString();

  const frequency: SearchScheduleFrequency = input.frequency ?? "daily";
  const hour =
    input.hour !== undefined ? input.hour : frequency === "daily" ? 2 : null;

  const values = {
    id,
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
    .where(eq(searchSchedules.id, id))
    .returning();

  if (!row) return null;
  return mapRowToSchedule(row as unknown as SearchScheduleRow);
}

/**
 * Delete a search schedule by id.
 */
export async function deleteSearchSchedule(id: string): Promise<boolean> {
  const result = await db
    .delete(searchSchedules)
    .where(eq(searchSchedules.id, id))
    .returning({ id: searchSchedules.id });

  return result.length > 0;
}

/**
 * Get all enabled search schedules (used by the scheduler to build timer
 * instances).
 */
export async function getEnabledSearchSchedules(): Promise<SearchSchedule[]> {
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
