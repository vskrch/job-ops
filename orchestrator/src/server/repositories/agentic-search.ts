import { randomUUID } from "node:crypto";
import { getCurrentUserId } from "@infra/request-context";
import type {
  AgenticSearch,
  AgenticSearchStatus,
  AgenticToolCall,
  BudgetUsage,
  JobVerification,
  JobVerificationStatus,
  SearchExpansion,
} from "@shared/types";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db/index";

const { agenticSearches, agenticToolCalls, jobVerifications } = schema;

function currentUserId(): string {
  return getCurrentUserId();
}

function mapRowToAgenticSearch(
  row: typeof agenticSearches.$inferSelect,
): AgenticSearch {
  return {
    id: row.id,
    originalQuery: row.originalQuery,
    queryHash: row.queryHash,
    status: row.status as AgenticSearchStatus,
    goal: (row.goal as AgenticSearch["goal"]) ?? null,
    hardConstraints:
      (row.hardConstraints as AgenticSearch["hardConstraints"]) ?? null,
    softPreferences:
      (row.softPreferences as AgenticSearch["softPreferences"]) ?? null,
    searchPlan: (row.searchPlan as AgenticSearch["searchPlan"]) ?? null,
    currentStep: row.currentStep,
    iterationCount: row.iterationCount,
    maxIterations: row.maxIterations,
    results: (row.results as AgenticSearch["results"]) ?? null,
    budgetUsed: (row.budgetUsed as AgenticSearch["budgetUsed"]) ?? null,
    searchExpansions:
      (row.searchExpansions as AgenticSearch["searchExpansions"]) ?? null,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    failureReason: row.failureReason,
    fallbackSearchId: row.fallbackSearchId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapRowToToolCall(
  row: typeof agenticToolCalls.$inferSelect,
): AgenticToolCall {
  return {
    id: row.id,
    searchId: row.searchId,
    toolName: row.toolName,
    argumentsSummary: row.argumentsSummary,
    resultSummary: row.resultSummary,
    status: row.status as AgenticToolCall["status"],
    latencyMs: row.latencyMs,
    iteration: row.iteration,
    createdAt: row.createdAt,
  };
}

function mapRowToVerification(
  row: typeof jobVerifications.$inferSelect,
): JobVerification {
  return {
    id: row.id,
    searchId: row.searchId,
    jobUrl: row.jobUrl,
    constraintKey: row.constraintKey,
    status: row.status as JobVerificationStatus,
    confidence: row.confidence,
    evidence: row.evidence,
    verifiedAt: row.verifiedAt,
  };
}

export async function createAgenticSearch(args: {
  originalQuery: string;
  queryHash: string;
  maxIterations?: number;
}): Promise<AgenticSearch> {
  const id = randomUUID();
  const now = new Date().toISOString();
  const userId = currentUserId();

  await db.insert(agenticSearches).values({
    id,
    userId,
    originalQuery: args.originalQuery,
    queryHash: args.queryHash,
    status: "created",
    iterationCount: 0,
    maxIterations: args.maxIterations ?? 5,
    createdAt: now,
    updatedAt: now,
  });

  const row = await db
    .select()
    .from(agenticSearches)
    .where(eq(agenticSearches.id, id))
    .limit(1);
  return mapRowToAgenticSearch(row[0]);
}

export async function updateAgenticSearch(
  id: string,
  update: Partial<{
    status: AgenticSearchStatus;
    goal: AgenticSearch["goal"];
    hardConstraints: AgenticSearch["hardConstraints"];
    softPreferences: AgenticSearch["softPreferences"];
    searchPlan: AgenticSearch["searchPlan"];
    currentStep: string;
    iterationCount: number;
    results: AgenticSearch["results"];
    budgetUsed: BudgetUsage;
    searchExpansions: SearchExpansion[];
    startedAt: string;
    completedAt: string;
    failureReason: string;
    fallbackSearchId: string | null;
    maxIterations: number;
  }>,
): Promise<void> {
  const setValues: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (update.status !== undefined) setValues.status = update.status;
  if (update.goal !== undefined) setValues.goal = update.goal;
  if (update.hardConstraints !== undefined)
    setValues.hardConstraints = update.hardConstraints;
  if (update.softPreferences !== undefined)
    setValues.softPreferences = update.softPreferences;
  if (update.searchPlan !== undefined) setValues.searchPlan = update.searchPlan;
  if (update.currentStep !== undefined)
    setValues.currentStep = update.currentStep;
  if (update.iterationCount !== undefined)
    setValues.iterationCount = update.iterationCount;
  if (update.results !== undefined) setValues.results = update.results;
  if (update.budgetUsed !== undefined) setValues.budgetUsed = update.budgetUsed;
  if (update.searchExpansions !== undefined)
    setValues.searchExpansions = update.searchExpansions;
  if (update.startedAt !== undefined) setValues.startedAt = update.startedAt;
  if (update.completedAt !== undefined)
    setValues.completedAt = update.completedAt;
  if (update.failureReason !== undefined)
    setValues.failureReason = update.failureReason;
  if (update.fallbackSearchId !== undefined)
    setValues.fallbackSearchId = update.fallbackSearchId;
  if (update.maxIterations !== undefined)
    setValues.maxIterations = update.maxIterations;

  await db
    .update(agenticSearches)
    .set(setValues)
    .where(eq(agenticSearches.id, id));
}

export async function getAgenticSearch(
  id: string,
): Promise<AgenticSearch | null> {
  const [row] = await db
    .select()
    .from(agenticSearches)
    .where(
      and(
        eq(agenticSearches.id, id),
        eq(agenticSearches.userId, currentUserId()),
      ),
    )
    .limit(1);
  return row ? mapRowToAgenticSearch(row) : null;
}

export async function listAgenticSearches(
  limit = 20,
): Promise<AgenticSearch[]> {
  const rows = await db
    .select()
    .from(agenticSearches)
    .where(eq(agenticSearches.userId, currentUserId()))
    .orderBy(desc(agenticSearches.createdAt))
    .limit(limit);
  return rows.map(mapRowToAgenticSearch);
}

export async function getAgenticSearchByHash(
  queryHash: string,
): Promise<AgenticSearch | null> {
  const [row] = await db
    .select()
    .from(agenticSearches)
    .where(
      and(
        eq(agenticSearches.userId, currentUserId()),
        eq(agenticSearches.queryHash, queryHash),
      ),
    )
    .orderBy(desc(agenticSearches.createdAt))
    .limit(1);
  return row ? mapRowToAgenticSearch(row) : null;
}

export async function addToolCall(args: {
  searchId: string;
  toolName: string;
  argumentsSummary?: string;
  resultSummary?: string;
  status: "pending" | "running" | "completed" | "failed";
  latencyMs?: number;
  iteration: number;
}): Promise<AgenticToolCall> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db.insert(agenticToolCalls).values({
    id,
    searchId: args.searchId,
    toolName: args.toolName,
    argumentsSummary: args.argumentsSummary ?? null,
    resultSummary: args.resultSummary ?? null,
    status: args.status,
    latencyMs: args.latencyMs ?? null,
    iteration: args.iteration,
    createdAt: now,
  });
  const [row] = await db
    .select()
    .from(agenticToolCalls)
    .where(eq(agenticToolCalls.id, id))
    .limit(1);
  return mapRowToToolCall(row);
}

export async function getToolCalls(
  searchId: string,
): Promise<AgenticToolCall[]> {
  const rows = await db
    .select()
    .from(agenticToolCalls)
    .where(eq(agenticToolCalls.searchId, searchId))
    .orderBy(agenticToolCalls.createdAt);
  return rows.map(mapRowToToolCall);
}

export async function addVerification(args: {
  searchId: string | null;
  jobUrl: string;
  constraintKey: string;
  status: JobVerificationStatus;
  confidence: number | null;
  evidence: string | null;
}): Promise<JobVerification> {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db
    .insert(jobVerifications)
    .values({
      id,
      searchId: args.searchId,
      jobUrl: args.jobUrl,
      constraintKey: args.constraintKey,
      status: args.status,
      confidence: args.confidence,
      evidence: args.evidence,
      verifiedAt: now,
    })
    .onConflictDoUpdate({
      target: [jobVerifications.jobUrl, jobVerifications.constraintKey],
      set: {
        searchId: args.searchId,
        status: args.status,
        confidence: args.confidence,
        evidence: args.evidence,
        verifiedAt: now,
      },
    });
  const [row] = await db
    .select()
    .from(jobVerifications)
    .where(eq(jobVerifications.id, id))
    .limit(1);
  return mapRowToVerification(row);
}

export async function getVerifications(
  searchId: string,
): Promise<JobVerification[]> {
  const rows = await db
    .select()
    .from(jobVerifications)
    .where(eq(jobVerifications.searchId, searchId))
    .orderBy(jobVerifications.verifiedAt);
  return rows.map(mapRowToVerification);
}

export async function getVerificationsByJobUrl(
  jobUrl: string,
): Promise<JobVerification[]> {
  const rows = await db
    .select()
    .from(jobVerifications)
    .where(eq(jobVerifications.jobUrl, jobUrl))
    .orderBy(jobVerifications.verifiedAt);
  return rows.map(mapRowToVerification);
}

export async function markOrphanedAgenticSearchesAsFailed(): Promise<number> {
  const now = new Date().toISOString();
  const inProgressStatuses = [
    "created",
    "planning",
    "searching",
    "normalizing",
    "deduplicating",
    "filtering",
    "evaluating",
    "verifying",
    "refining",
    "ranking",
    "reporting",
  ] as const;

  const result = await db
    .update(agenticSearches)
    .set({
      status: "failed",
      failureReason: "Search interrupted by server restart",
      completedAt: now,
      updatedAt: now,
    })
    .where(inArray(agenticSearches.status, [...inProgressStatuses]))
    .returning({ id: agenticSearches.id });
  return result.length;
}
