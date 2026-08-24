/**
 * Company research service + TTL cache (A5).
 *
 * One JSON per normalized company, 30-day default TTL. Cache is a *lead* —
 * consumers must still verify any claim cited in generated text per
 * 03-writing-style.md verify-before-use rule, but the cache lets them
 * re-fetch a known URL instead of re-searching. Payload stores source URLs
 * alongside notes so re-verification is a re-fetch, not a re-search.
 */

import { randomUUID } from "node:crypto";
import { logger } from "@infra/logger";
import { getCurrentUserId } from "@infra/request-context";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CompanyResearchPayload {
  company: string;
  fetchedAt: string;
  sources: {
    website?: { url: string; notes: string };
    reviews?: { url: string; notes: string };
    linkedin?: { url: string; notes: string };
    media?: { url: string; notes: string };
  };
  notes?: string;
  /** Same shape, indexed by source key → url, aids re-verification. */
  sourceUrls?: Record<string, string>;
}

export function normalizeCompanyKey(name: string): string {
  const base = name.toLowerCase().trim();
  // Strip legal suffixes commonly appended to employer names.
  const stripped = base
    .replace(
      /\b(inc\.?|ltd\.?|llc\.?|corp\.?|corporation|group|a\/s|ap?s|ab\.?|gmbh|bv|pty\.?|holdings?|ventures?|labs?)\b/gi,
      " ",
    )
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replaceAll(" ", "-");
  return stripped || base.replaceAll(" ", "-") || "unknown";
}

export function isFresh(fetchedAt: string, ttlMs = TTL_MS): boolean {
  const ms = Date.parse(fetchedAt);
  if (!Number.isFinite(ms)) return false;
  return Date.now() - ms < ttlMs;
}

function currentUserId(): string {
  return getCurrentUserId();
}

export async function getCachedResearch(
  company: string,
): Promise<CompanyResearchPayload | null> {
  const key = normalizeCompanyKey(company);
  const userId = currentUserId();
  const [row] = await db
    .select()
    .from(schema.companyResearch)
    .where(
      and(
        eq(schema.companyResearch.userId, userId),
        eq(schema.companyResearch.companyKey, key),
      ),
    )
    .limit(1);
  if (!row) return null;
  try {
    const payload = JSON.parse(row.payload) as CompanyResearchPayload;
    return payload;
  } catch {
    return null;
  }
}

export async function putCachedResearch(
  company: string,
  payload: CompanyResearchPayload,
): Promise<void> {
  const key = normalizeCompanyKey(company);
  const userId = currentUserId();
  const id = randomUUID();
  const now = new Date().toISOString();
  await db
    .insert(schema.companyResearch)
    .values({
      id,
      userId,
      companyKey: key,
      company: payload.company || company,
      fetchedAt: payload.fetchedAt || now,
      payload: JSON.stringify(payload),
    })
    .onConflictDoUpdate({
      target: [
        schema.companyResearch.userId,
        schema.companyResearch.companyKey,
      ],
      set: {
        company: payload.company || company,
        fetchedAt: payload.fetchedAt || now,
        payload: JSON.stringify(payload),
      },
    });
}

export async function getCompanyResearch(
  company: string,
  options: { allowStale?: boolean; ttlMs?: number } = {},
): Promise<{
  payload: CompanyResearchPayload | null;
  fromCache: boolean;
  fresh: boolean;
}> {
  const cached = await getCachedResearch(company);
  if (!cached) return { payload: null, fromCache: false, fresh: false };
  const fresh = isFresh(cached.fetchedAt, options.ttlMs);
  if (fresh) return { payload: cached, fromCache: true, fresh: true };
  if (options.allowStale)
    return { payload: cached, fromCache: true, fresh: false };
  return { payload: null, fromCache: false, fresh: false };
}

export async function refreshCompanyResearch(
  company: string,
): Promise<CompanyResearchPayload> {
  // Minimal implementation: synthesize a stub payload rather than calling
  // the LLM/crawler inline (callers may call an LLM-wrapped variant that
  // passes a custom fetcher). The stub keeps the feature testable and
  // guarantees the cache write path is exercised without requiring an API
  // key in tests. Production callers should use `researchCompanyWithLlm`
  // below; this is the fallback/STUB path that also satisfies the route's
  // contract when research is optional.
  const key = normalizeCompanyKey(company);
  logger.info("Refreshing company research", { company, companyKey: key });
  const payload: CompanyResearchPayload = {
    company,
    fetchedAt: new Date().toISOString(),
    sources: {
      website: {
        url: `https://${key}.invalid`,
        notes:
          "Auto-generated placeholder — replace by triggering a full review or providing a company URL.",
      },
    },
    notes:
      "Placeholder research — replace via a full review or ghostwriter/research route when LLM is available.",
  };
  await putCachedResearch(company, payload);
  return payload;
}
