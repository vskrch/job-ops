/**
 * Job search repository - data access layer for job searches.
 */

import { randomUUID } from "node:crypto";
import { getCurrentUserId } from "@infra/request-context";
import type {
  JobSearch,
  JobSearchListItem,
  JobSearchResults,
  JobSearchStatus,
  ParsedSearchSpec,
  SearchEmailStatus,
} from "@shared/types";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const { jobSearches } = schema;

function currentUserId(): string {
  return getCurrentUserId();
}

function mapRowToJobSearch(row: typeof jobSearches.$inferSelect): JobSearch {
  const parsedSpec = row.parsedSpec as ParsedSearchSpec | null;
  const results = row.results as JobSearchResults | null;
  return {
    id: row.id,
    originalQuery: row.originalQuery,
    queryHash: row.queryHash,
    parsedSpec,
    status: row.status as JobSearchStatus,
    results,
    sourcesSearched: parseJsonArray(row.sourcesSearched),
    sourcesSucceeded: parseJsonArray(row.sourcesSucceeded),
    sourcesFailed: parseJsonArray(row.sourcesFailed),
    searchStartedAt: row.searchStartedAt,
    searchCompletedAt: row.searchCompletedAt,
    emailStatus: row.emailStatus as SearchEmailStatus,
    emailSentAt: row.emailSentAt,
    emailError: row.emailError,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function parseJsonArray(raw: unknown): string[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string");
}

export async function createJobSearch(args: {
  originalQuery: string;
  queryHash: string;
  parsedSpec: ParsedSearchSpec | null;
  sourcesSearched: string[];
}): Promise<JobSearch> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const userId = currentUserId();

  await db.insert(jobSearches).values({
    id,
    userId,
    queryHash: args.queryHash,
    originalQuery: args.originalQuery,
    parsedSpec: args.parsedSpec,
    status: "running",
    sourcesSearched: args.sourcesSearched,
    sourcesSucceeded: [],
    sourcesFailed: [],
    searchStartedAt: now,
    emailStatus: "pending",
    createdAt: now,
    updatedAt: now,
  });

  return {
    id,
    originalQuery: args.originalQuery,
    queryHash: args.queryHash,
    parsedSpec: args.parsedSpec,
    status: "running",
    results: null,
    sourcesSearched: args.sourcesSearched,
    sourcesSucceeded: [],
    sourcesFailed: [],
    searchStartedAt: now,
    searchCompletedAt: null,
    emailStatus: "pending",
    emailSentAt: null,
    emailError: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  };
}

export async function updateJobSearch(
  id: string,
  update: Partial<{
    status: JobSearchStatus;
    results: JobSearchResults | null;
    sourcesSucceeded: string[];
    sourcesFailed: string[];
    searchCompletedAt: string;
    emailStatus: SearchEmailStatus;
    emailSentAt: string;
    emailError: string;
    errorMessage: string;
  }>,
): Promise<void> {
  const setValues: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (update.status !== undefined) setValues.status = update.status;
  if (update.results !== undefined)
    setValues.results = update.results ? JSON.stringify(update.results) : null;
  if (update.sourcesSucceeded !== undefined)
    setValues.sourcesSucceeded = JSON.stringify(update.sourcesSucceeded);
  if (update.sourcesFailed !== undefined)
    setValues.sourcesFailed = JSON.stringify(update.sourcesFailed);
  if (update.searchCompletedAt !== undefined)
    setValues.searchCompletedAt = update.searchCompletedAt;
  if (update.emailStatus !== undefined)
    setValues.emailStatus = update.emailStatus;
  if (update.emailSentAt !== undefined)
    setValues.emailSentAt = update.emailSentAt;
  if (update.emailError !== undefined) setValues.emailError = update.emailError;
  if (update.errorMessage !== undefined)
    setValues.errorMessage = update.errorMessage;

  await db
    .update(jobSearches)
    .set(setValues)
    .where(
      and(eq(jobSearches.id, id), eq(jobSearches.userId, currentUserId())),
    );
}

export async function getJobSearch(id: string): Promise<JobSearch | null> {
  const [row] = await db
    .select()
    .from(jobSearches)
    .where(and(eq(jobSearches.id, id), eq(jobSearches.userId, currentUserId())))
    .limit(1);
  return row ? mapRowToJobSearch(row) : null;
}

export async function getJobSearchByHash(
  queryHash: string,
): Promise<JobSearch | null> {
  const [row] = await db
    .select()
    .from(jobSearches)
    .where(
      and(
        eq(jobSearches.queryHash, queryHash),
        eq(jobSearches.userId, currentUserId()),
      ),
    )
    .orderBy(desc(jobSearches.createdAt))
    .limit(1);
  return row ? mapRowToJobSearch(row) : null;
}

export async function getRecentJobSearches(
  limit = 20,
): Promise<JobSearchListItem[]> {
  const rows = await db
    .select()
    .from(jobSearches)
    .where(eq(jobSearches.userId, currentUserId()))
    .orderBy(desc(jobSearches.createdAt))
    .limit(limit);

  return rows.map((row) => {
    const results = row.results as JobSearchResults | null;
    return {
      id: row.id,
      originalQuery: row.originalQuery,
      status: row.status as JobSearchStatus,
      totalDiscovered: results?.totalDiscovered ?? 0,
      totalAfterFilter: results?.totalAfterFilter ?? 0,
      emailStatus: row.emailStatus as SearchEmailStatus,
      createdAt: row.createdAt,
      searchCompletedAt: row.searchCompletedAt,
    };
  });
}

export async function markOrphanedSearchesAsFailed(): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .update(jobSearches)
    .set({
      status: "failed",
      searchCompletedAt: now,
      errorMessage: "Search interrupted by server restart",
      updatedAt: now,
    })
    .where(eq(jobSearches.status, "running"))
    .returning({ id: jobSearches.id });
  return result.length;
}
