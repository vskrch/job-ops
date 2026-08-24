/**
 * Minimal application-artifacts store for prep packs, follow-ups, form text,
 * reviews, and upskill reports. Shared by A8/B1/C3/B3.
 */

import { randomUUID } from "node:crypto";
import { getCurrentUserId } from "@infra/request-context";
import { and, desc, eq } from "drizzle-orm";
import { db, schema } from "../db/index";

export type ArtifactKind =
  | "prep_pack"
  | "followup"
  | "thank_you"
  | "form_text"
  | "review"
  | "upskill";

function currentUserId(): string {
  return getCurrentUserId();
}

export async function createArtifact(args: {
  jobId: string;
  kind: ArtifactKind;
  content: string;
  stage?: string | null;
}): Promise<typeof schema.applicationArtifacts.$inferSelect> {
  const id = randomUUID();
  await db.insert(schema.applicationArtifacts).values({
    id,
    userId: currentUserId(),
    jobId: args.jobId,
    kind: args.kind,
    stage: args.stage ?? null,
    content: args.content,
  });
  const [row] = await db
    .select()
    .from(schema.applicationArtifacts)
    .where(eq(schema.applicationArtifacts.id, id))
    .limit(1);
  return row;
}

export async function listArtifactsForJob(
  jobId: string,
): Promise<Array<typeof schema.applicationArtifacts.$inferSelect>> {
  return db
    .select()
    .from(schema.applicationArtifacts)
    .where(
      and(
        eq(schema.applicationArtifacts.userId, currentUserId()),
        eq(schema.applicationArtifacts.jobId, jobId),
      ),
    )
    .orderBy(desc(schema.applicationArtifacts.createdAt));
}
