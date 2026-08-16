import { getCurrentUserId } from "@infra/request-context";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const { designResumeAssets, designResumeDocuments } = schema;

function currentUserId(): string {
  return getCurrentUserId();
}

export async function getLatestDesignResumeDocument(
  userId: string = currentUserId(),
) {
  const [row] = await db
    .select()
    .from(designResumeDocuments)
    .where(eq(designResumeDocuments.userId, userId))
    .orderBy(desc(designResumeDocuments.updatedAt))
    .limit(1);
  return row ?? null;
}

export async function getDesignResumeDocumentById(
  id: string,
  userId: string = currentUserId(),
) {
  const [row] = await db
    .select()
    .from(designResumeDocuments)
    .where(
      and(
        eq(designResumeDocuments.id, id),
        eq(designResumeDocuments.userId, userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function listDesignResumeAssets(documentId: string) {
  return db
    .select()
    .from(designResumeAssets)
    .where(eq(designResumeAssets.documentId, documentId))
    .orderBy(desc(designResumeAssets.updatedAt));
}

export async function getDesignResumeAssetById(id: string) {
  const [row] = await db
    .select()
    .from(designResumeAssets)
    .where(eq(designResumeAssets.id, id))
    .limit(1);
  return row ?? null;
}

export async function upsertDesignResumeDocument(
  input: {
    id: string;
    title: string;
    resumeJson: Record<string, unknown>;
    revision: number;
    sourceResumeId: string | null;
    sourceMode: "v4" | "v5" | null;
    importedAt: string | null;
    createdAt?: string;
    updatedAt: string;
  },
  userId: string = currentUserId(),
) {
  const existing = await getDesignResumeDocumentById(input.id, userId);
  if (existing) {
    await db
      .update(designResumeDocuments)
      .set({
        title: input.title,
        resumeJson: input.resumeJson,
        revision: input.revision,
        sourceResumeId: input.sourceResumeId,
        sourceMode: input.sourceMode,
        importedAt: input.importedAt,
        updatedAt: input.updatedAt,
      })
      .where(
        and(
          eq(designResumeDocuments.id, input.id),
          eq(designResumeDocuments.userId, userId),
        ),
      );
  } else {
    await db.insert(designResumeDocuments).values({
      id: input.id,
      userId,
      title: input.title,
      resumeJson: input.resumeJson,
      revision: input.revision,
      sourceResumeId: input.sourceResumeId,
      sourceMode: input.sourceMode,
      importedAt: input.importedAt,
      createdAt: input.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt,
    });
  }

  return getDesignResumeDocumentById(input.id, userId);
}

export async function insertDesignResumeAsset(input: {
  id: string;
  documentId: string;
  kind: "picture";
  originalName: string;
  mimeType: string;
  byteSize: number;
  storagePath: string;
  createdAt?: string;
  updatedAt: string;
}) {
  await db.insert(designResumeAssets).values({
    id: input.id,
    documentId: input.documentId,
    kind: input.kind,
    originalName: input.originalName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    storagePath: input.storagePath,
    createdAt: input.createdAt ?? input.updatedAt,
    updatedAt: input.updatedAt,
  });

  return getDesignResumeAssetById(input.id);
}

export async function deleteDesignResumeAsset(id: string) {
  await db.delete(designResumeAssets).where(eq(designResumeAssets.id, id));
}

export async function deleteDesignResumeAssetsForDocument(documentId: string) {
  await db
    .delete(designResumeAssets)
    .where(eq(designResumeAssets.documentId, documentId));
}

export async function deleteDesignResumeDocument(
  id: string,
  userId: string = currentUserId(),
) {
  await db
    .delete(designResumeDocuments)
    .where(
      and(
        eq(designResumeDocuments.id, id),
        eq(designResumeDocuments.userId, userId),
      ),
    );
}

export async function findDesignResumeAssetForDocument(args: {
  documentId: string;
  kind: "picture";
}) {
  const [row] = await db
    .select()
    .from(designResumeAssets)
    .where(
      and(
        eq(designResumeAssets.documentId, args.documentId),
        eq(designResumeAssets.kind, args.kind),
      ),
    )
    .limit(1);
  return row ?? null;
}
