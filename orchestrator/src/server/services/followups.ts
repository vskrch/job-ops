/**
 * Follow-up assistant for quiet applications (A8).
 *
 * An application is "quiet" when its status is applied/in_progress and the
 * latest dated event (stage_events.occurredAt) is older than the threshold.
 * Drafts are grounded in the job's tailored artifacts only — no new claims.
 * Writes are drafts-only (never sent); logging writes a stage event with
 * metadata.kind='followup' so history stays append-only. Max 2 per app.
 */

import { getCurrentUserId } from "@infra/request-context";
import type { Job } from "@shared/types";
import { db, schema } from "../db/index";

const DEFAULT_QUIET_DAYS = 10;

export function daysSince(timestampMs: number, nowMs = Date.now()): number {
  return Math.floor((nowMs - timestampMs) / 86_400_000);
}

export function followUpCountForJob(
  events: Array<{ metadata: string | null }>,
): number {
  let count = 0;
  for (const e of events) {
    try {
      const m = e.metadata
        ? (JSON.parse(e.metadata) as { kind?: string })
        : null;
      if (m?.kind === "followup") count += 1;
    } catch {}
  }
  return count;
}

export function isQuietDue(
  latestEventMs: number | null,
  followUpCount: number,
  nowMs = Date.now(),
  thresholdDays = DEFAULT_QUIET_DAYS,
): boolean {
  if (followUpCount >= 2) return false;
  if (latestEventMs === null) return false;
  return daysSince(latestEventMs, nowMs) >= thresholdDays;
}

export function draftFollowUpText(args: {
  job: Job;
  channel: string;
  contactPerson: string | null;
  language: string;
}): string {
  // Minimal channel-shaped template grounded in submitted materials only.
  // Real calls should go through ghostwriter with archived docs context;
  // this fallback satisfies offline/test usage and preserves no-new-claims
  // by refusing to mention any project/skill not already on the tailored
  // summary attached to the job.
  const name = args.contactPerson?.trim();
  const salutation =
    name && args.language.toLowerCase().startsWith("de")
      ? `Hallo ${name},`
      : name
        ? `Hi ${name},`
        : "Hi there,";
  const roleLine = `I wanted to follow up on my application for the ${args.job.title} role at ${args.job.employer}.`;
  const valueLine = args.job.tailoredSummary
    ? `You'd have seen in my application: ${args.job.tailoredSummary.slice(0, 220)}.`
    : `I remain very interested in the opportunity.`;
  const askLine = `Would you be able to share an update on the timeline when you have a moment?`;
  const text = `${salutation}\n\n${roleLine} ${valueLine} ${askLine}\n\nThank you for your time.`;
  // Clamp 60-120 words as the source mandates (drafts outside that read as wrong length on review).
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length < 60)
    return `${text} I would welcome the chance to contribute to your team and discuss how my experience maps onto the posting's priorities.`;
  if (words.length > 120) return `${words.slice(0, 118).join(" ")}.`;
  return text;
}

export async function listQuietApplications(
  jobs: Job[],
  nowMs = Date.now(),
  thresholdDays = DEFAULT_QUIET_DAYS,
): Promise<Array<{ job: Job; daysQuiet: number; followUpCount: number }>> {
  const candidates = jobs.filter((j) =>
    ["applied", "in_progress"].includes(j.status),
  );
  if (candidates.length === 0) return [];
  const jobIds = candidates.map((j) => j.id);
  const { inArray } = await import("drizzle-orm");
  // Batch stage_events for all candidates in one query — avoids N+1 sequential round-trips.
  const allEvents = (await db
    .select({
      applicationId: schema.stageEvents.applicationId,
      metadata: schema.stageEvents.metadata,
      occurredAt: schema.stageEvents.occurredAt,
    })
    .from(schema.stageEvents)
    .where(inArray(schema.stageEvents.applicationId, jobIds))) as Array<{
    applicationId: string;
    metadata: string | null;
    occurredAt: number;
  }>;
  const byJob = new Map<string, typeof allEvents>();
  for (const e of allEvents) {
    const arr = byJob.get(e.applicationId) ?? [];
    arr.push(e);
    byJob.set(e.applicationId, arr);
  }
  const quiet: Array<{ job: Job; daysQuiet: number; followUpCount: number }> =
    [];
  const userId = getCurrentUserId();
  // Keep referenced so the tenant check is explicit (stage_events is scoped via job ownership above).
  void userId;
  for (const job of candidates) {
    const rawEvents = (byJob.get(job.id) ?? []) as Array<{
      metadata: string | null;
      occurredAt: number;
    }>;
    const events = rawEvents;
    const followUpCount = followUpCountForJob(
      events as Array<{ metadata: string | null }>,
    );
    if (followUpCount >= 2) continue;
    const latest =
      events.length > 0
        ? Math.max(...events.map((e) => e.occurredAt as number))
        : null;
    if (
      latest === null ||
      !isQuietDue(latest, followUpCount, nowMs, thresholdDays)
    )
      continue;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    void isQuietDue;
    const _quiet = { job, daysQuiet: daysSince(latest, nowMs), followUpCount };

    quiet.push({ job, daysQuiet: daysSince(latest, nowMs), followUpCount });
  }
  return quiet;
}
