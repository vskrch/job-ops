import { randomUUID } from "node:crypto";
import { getCurrentUserId } from "@infra/request-context";
import type {
  PostApplicationProvider,
  PostApplicationSyncRun,
  PostApplicationSyncRunStatus,
} from "@shared/types";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db";

const { postApplicationSyncRuns } = schema;

function currentUserId(): string {
  return getCurrentUserId();
}

type StartPostApplicationSyncRunInput = {
  provider: PostApplicationProvider;
  accountKey: string;
  integrationId: string | null;
};

type CompletePostApplicationSyncRunInput = {
  id: string;
  status: Exclude<PostApplicationSyncRunStatus, "running">;
  messagesDiscovered: number;
  messagesRelevant: number;
  messagesClassified: number;
  messagesMatched?: number;
  messagesApproved?: number;
  messagesDenied?: number;
  messagesErrored: number;
  errorCode?: string | null;
  errorMessage?: string | null;
};

function mapRowToSyncRun(
  row: typeof postApplicationSyncRuns.$inferSelect,
): PostApplicationSyncRun {
  return {
    id: row.id,
    provider: row.provider,
    accountKey: row.accountKey,
    integrationId: row.integrationId,
    status: row.status as PostApplicationSyncRunStatus,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    messagesDiscovered: row.messagesDiscovered,
    messagesRelevant: row.messagesRelevant,
    messagesClassified: row.messagesClassified,
    messagesMatched: row.messagesMatched,
    messagesApproved: row.messagesApproved,
    messagesDenied: row.messagesDenied,
    messagesErrored: row.messagesErrored,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function startPostApplicationSyncRun(
  input: StartPostApplicationSyncRunInput,
  userId: string = currentUserId(),
): Promise<PostApplicationSyncRun> {
  const id = randomUUID();
  const nowEpoch = Date.now();
  const nowIso = new Date(nowEpoch).toISOString();

  await db.insert(postApplicationSyncRuns).values({
    id,
    userId,
    provider: input.provider,
    accountKey: input.accountKey,
    integrationId: input.integrationId,
    status: "running",
    startedAt: nowEpoch,
    completedAt: null,
    messagesDiscovered: 0,
    messagesRelevant: 0,
    messagesClassified: 0,
    messagesMatched: 0,
    messagesApproved: 0,
    messagesDenied: 0,
    messagesErrored: 0,
    errorCode: null,
    errorMessage: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  });

  const run = await getPostApplicationSyncRunById(id, userId);
  if (!run) {
    throw new Error(`Failed to load created post-application sync run ${id}.`);
  }
  return run;
}

export async function completePostApplicationSyncRun(
  input: CompletePostApplicationSyncRunInput,
  userId: string = currentUserId(),
): Promise<PostApplicationSyncRun | null> {
  const nowEpoch = Date.now();
  const nowIso = new Date(nowEpoch).toISOString();

  await db
    .update(postApplicationSyncRuns)
    .set({
      status: input.status,
      completedAt: nowEpoch,
      messagesDiscovered: input.messagesDiscovered,
      messagesRelevant: input.messagesRelevant,
      messagesClassified: input.messagesClassified,
      messagesMatched: input.messagesMatched ?? 0,
      messagesApproved: input.messagesApproved ?? 0,
      messagesDenied: input.messagesDenied ?? 0,
      messagesErrored: input.messagesErrored,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(postApplicationSyncRuns.id, input.id),
        eq(postApplicationSyncRuns.userId, userId),
      ),
    );

  return getPostApplicationSyncRunById(input.id, userId);
}

export async function getPostApplicationSyncRunById(
  id: string,
  userId: string = currentUserId(),
): Promise<PostApplicationSyncRun | null> {
  const [row] = await db
    .select()
    .from(postApplicationSyncRuns)
    .where(
      and(
        eq(postApplicationSyncRuns.id, id),
        eq(postApplicationSyncRuns.userId, userId),
      ),
    );
  return row ? mapRowToSyncRun(row) : null;
}

export async function listPostApplicationSyncRuns(
  provider: PostApplicationProvider,
  accountKey: string,
  limit = 20,
  userId: string = currentUserId(),
): Promise<PostApplicationSyncRun[]> {
  const rows = await db
    .select()
    .from(postApplicationSyncRuns)
    .where(
      and(
        eq(postApplicationSyncRuns.userId, userId),
        eq(postApplicationSyncRuns.provider, provider),
        eq(postApplicationSyncRuns.accountKey, accountKey),
      ),
    )
    .orderBy(desc(postApplicationSyncRuns.startedAt))
    .limit(limit);
  return rows.map(mapRowToSyncRun);
}
