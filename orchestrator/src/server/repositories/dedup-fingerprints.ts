/**
 * Dedup Fingerprints repository (ADR-008).
 *
 * Persists content and URL fingerprints for cross-search deduplication and history tracking.
 */

import { inArray } from "drizzle-orm";
import { db, schema } from "../db/index";

const { dedupFingerprints } = schema;

export async function hasFingerprint(fingerprint: string): Promise<boolean> {
  const [row] = await db
    .select({ fingerprint: dedupFingerprints.fingerprint })
    .from(dedupFingerprints)
    .where(inArray(dedupFingerprints.fingerprint, [fingerprint]));
  return Boolean(row);
}

export async function recordFingerprints(
  entries: Array<{ fingerprint: string; canonicalJobUrl: string }>,
): Promise<void> {
  if (entries.length === 0) return;
  const now = new Date().toISOString();

  for (const entry of entries) {
    try {
      await db
        .insert(dedupFingerprints)
        .values({
          fingerprint: entry.fingerprint,
          canonicalJobUrl: entry.canonicalJobUrl,
          firstSeenAt: now,
          lastSeenAt: now,
        })
        .onConflictDoUpdate({
          target: dedupFingerprints.fingerprint,
          set: { lastSeenAt: now },
        });
    } catch {
      // Ignore conflict error
    }
  }
}
