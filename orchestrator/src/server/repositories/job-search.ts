/**
 * Job search repository - data access layer for job searches.
 */

import { randomUUID } from "node:crypto";
import { getCurrentUserId } from "@infra/request-context";
import type {
  JobSearch,
  JobSearchListItem,
  JobSearchPhase,
  JobSearchResults,
  JobSearchStatus,
  ParsedSearchSpec,
  SearchEmailStatus,
  SearchSourcePlan,
} from "@shared/types";
import { and, desc, eq, gt, or } from "drizzle-orm";
import { db, schema } from "../db/index";

const { jobSearches } = schema;

function currentUserId(): string {
  return getCurrentUserId();
}

function mapRowToJobSearch(row: typeof jobSearches.$inferSelect): JobSearch {
  const parsedSpec = row.parsedSpec as ParsedSearchSpec | null;
  const results = row.results as JobSearchResults | null;
  const sourcePlan = row.sourcePlan as SearchSourcePlan | null;
  return {
    id: row.id,
    originalQuery: row.originalQuery,
    admissionHash: row.admissionHash,
    specHash: row.specHash,
    parserVersion: row.parserVersion ?? "",
    sourcePlanVersion: row.sourcePlanVersion ?? "",
    parsedSpec,
    phase: row.phase as JobSearchPhase,
    status: row.status as JobSearchStatus,
    results,
    resultVersion: row.resultVersion,
    sourcePlan,
    evaluationTime: row.evaluationTime,
    sourcesSearched: (row.sourcesSearched as string[]) ?? [],
    sourcesSucceeded: (row.sourcesSucceeded as string[]) ?? [],
    sourcesFailed: (row.sourcesFailed as string[]) ?? [],
    searchStartedAt: row.searchStartedAt,
    searchCompletedAt: row.searchCompletedAt,
    emailStatus: row.emailStatus as SearchEmailStatus,
    emailSentAt: row.emailSentAt,
    emailError: row.emailError,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastProgressAt: row.lastProgressAt,
  };
}

/**
 * Create a queued search with a synchronously-computed admission hash.
 * Returns null when a search with the same admission hash is already running
 * (guarded by the partial unique index on active rows).
 */
export async function createJobSearch(args: {
  admissionHash: string;
  originalQuery: string;
  parserVersion: string;
  sourcePlanVersion: string;
}): Promise<JobSearch | null> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const userId = currentUserId();

  const result = await db
    .insert(jobSearches)
    .values({
      id,
      userId,
      admissionHash: args.admissionHash,
      specHash: null,
      parserVersion: args.parserVersion,
      sourcePlanVersion: args.sourcePlanVersion,
      originalQuery: args.originalQuery,
      parsedSpec: null,
      phase: "queued",
      status: "running",
      sourcesSearched: [],
      sourcesSucceeded: [],
      sourcesFailed: [],
      results: null,
      resultVersion: 0,
      sourcePlan: null,
      evaluationTime: null,
      searchStartedAt: now,
      emailStatus: "pending",
      lastProgressAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning({ id: jobSearches.id });

  if (result.length === 0) {
    return null;
  }

  return getJobSearch(id);
}

export async function updateJobSearch(
  id: string,
  update: Partial<{
    status: JobSearchStatus;
    phase: JobSearchPhase;
    specHash: string;
    parsedSpec: ParsedSearchSpec;
    results: JobSearchResults;
    resultVersion: number;
    sourcePlan: SearchSourcePlan;
    evaluationTime: string;
    sourcesSearched: string[];
    sourcesSucceeded: string[];
    sourcesFailed: string[];
    searchCompletedAt: string;
    emailStatus: SearchEmailStatus;
    emailSentAt: string;
    emailError: string | null;
    errorMessage: string;
    lastProgressAt: string;
  }>,
): Promise<void> {
  const setValues: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (update.status !== undefined) setValues.status = update.status;
  if (update.phase !== undefined) setValues.phase = update.phase;
  if (update.specHash !== undefined) setValues.specHash = update.specHash;
  if (update.parsedSpec !== undefined) setValues.parsedSpec = update.parsedSpec;
  if (update.results !== undefined) setValues.results = update.results;
  if (update.resultVersion !== undefined)
    setValues.resultVersion = update.resultVersion;
  if (update.sourcePlan !== undefined) setValues.sourcePlan = update.sourcePlan;
  if (update.evaluationTime !== undefined)
    setValues.evaluationTime = update.evaluationTime;
  if (update.sourcesSearched !== undefined)
    setValues.sourcesSearched = update.sourcesSearched;
  if (update.sourcesSucceeded !== undefined)
    setValues.sourcesSucceeded = update.sourcesSucceeded;
  if (update.sourcesFailed !== undefined)
    setValues.sourcesFailed = update.sourcesFailed;
  if (update.searchCompletedAt !== undefined)
    setValues.searchCompletedAt = update.searchCompletedAt;
  if (update.emailStatus !== undefined) setValues.emailStatus = update.emailStatus;
  if (update.emailSentAt !== undefined) setValues.emailSentAt = update.emailSentAt;
  if (update.emailError !== undefined) setValues.emailError = update.emailError;
  if (update.errorMessage !== undefined)
    setValues.errorMessage = update.errorMessage;
  if (update.lastProgressAt !== undefined)
    setValues.lastProgressAt = update.lastProgressAt;

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
    .where(
      and(eq(jobSearches.id, id), eq(jobSearches.userId, currentUserId())),
    )
    .limit(1);
  return row ? mapRowToJobSearch(row) : null;
}

/**
 * Find an active (running) search with the same admission hash. Used to
 * deduplicate concurrent identical submissions.
 */
export async function getRunningSearchByAdmissionHash(
  admissionHash: string,
): Promise<JobSearch | null> {
  const [row] = await db
    .select()
    .from(jobSearches)
    .where(
      and(
        eq(jobSearches.userId, currentUserId()),
        eq(jobSearches.admissionHash, admissionHash),
        eq(jobSearches.status, "running"),
      ),
    )
    .orderBy(desc(jobSearches.createdAt))
    .limit(1);
  return row ? mapRowToJobSearch(row) : null;
}

/**
 * Find a reusable search for the same admission hash: an active search, or a
 * completed search within the cache TTL window. Null when nothing is reusable.
 */
export async function findReusableSearch(
  admissionHash: string,
  cacheTtlMs: number,
): Promise<JobSearch | null> {
  const userId = currentUserId();
  const cutoff = new Date(Date.now() - Math.max(0, cacheTtlMs)).toISOString();

  const [row] = await db
    .select()
    .from(jobSearches)
    .where(
      and(
        eq(jobSearches.userId, userId),
        eq(jobSearches.admissionHash, admissionHash),
        or(
          eq(jobSearches.status, "running"),
          and(
            eq(jobSearches.status, "completed"),
            gt(jobSearches.searchCompletedAt, cutoff),
          ),
        ),
      ),
    )
    .orderBy(desc(jobSearches.createdAt))
    .limit(1);
  return row ? mapRowToJobSearch(row) : null;
}

/**
 * Find a completed search with the same semantic spec hash (post-parse).
 * Reserved for future semantic-equivalence reconciliation.
 */
export async function getJobSearchBySpecHash(
  specHash: string,
): Promise<JobSearch | null> {
  const [row] = await db
    .select()
    .from(jobSearches)
    .where(
      and(
        eq(jobSearches.specHash, specHash),
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
      phase: row.phase as JobSearchPhase,
      totalDiscovered: results?.totalDiscovered ?? 0,
      totalAfterFilter: results?.totalAfterFilter ?? 0,
      emailStatus: row.emailStatus as SearchEmailStatus,
      createdAt: row.createdAt,
      searchCompletedAt: row.searchCompletedAt,
    };
  });
}

/**
 * Mark any active searches as failed — call once at boot to recover from
 * unclean shutdowns (crash, SIGKILL, power loss).
 */
export async function markOrphanedSearchesAsFailed(): Promise<number> {
  const now = new Date().toISOString();
  const result = await db
    .update(jobSearches)
    .set({
      status: "failed",
      errorMessage: "Search interrupted by server restart",
      lastProgressAt: now,
      updatedAt: now,
    })
    .where(eq(jobSearches.status, "running"))
    .returning({ id: jobSearches.id });
  return result.length;
}