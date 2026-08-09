/**
 * Multi-signal deduplication for jobs from multiple sources.
 *
 * Uses source job ID, canonical URL, application URL, and content fingerprint
 * to detect duplicates. When duplicates are found, keeps the record with more
 * complete data and merges source lists.
 */

import type { CreateJobInput } from "@shared/types";

export interface DedupResult {
  /** Canonical jobs after dedup. */
  jobs: Array<CreateJobInput & { sources: string[] }>;
  /** Number of duplicate records removed. */
  duplicatesRemoved: number;
}

function normalizeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    // Strip trailing slash, lowercase host, strip common tracking params.
    u.hostname = u.hostname.toLowerCase();
    u.hash = "";
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "gclid",
      "source",
      "ref",
    ];
    for (const p of trackingParams) {
      u.searchParams.delete(p);
    }
    let path = u.pathname.replace(/\/+$/, "");
    if (!path) path = "/";
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch {
    return null;
  }
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEmployer(employer: string): string {
  return employer
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLocation(location: string | undefined): string {
  if (!location) return "";
  return location
    .toLowerCase()
    .replace(/[^a-z0-9\s,]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function descriptionFingerprint(desc: string | undefined): string {
  if (!desc) return "";
  const normalized = desc
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.slice(0, 500);
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => i);
  for (let j = 1; j <= b.length; j++) {
    let prev = dp[0];
    dp[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const tmp = dp[i];
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      prev = tmp;
    }
  }
  return dp[a.length];
}

function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const maxLen = Math.max(na.length, nb.length);
  return 1 - levenshtein(na, nb) / maxLen;
}

/**
 * Count non-null/undefined fields on a CreateJobInput to measure completeness.
 */
function completenessScore(job: CreateJobInput): number {
  let score = 0;
  const fields: Array<keyof CreateJobInput> = [
    "title",
    "employer",
    "jobUrl",
    "location",
    "salary",
    "jobDescription",
    "datePosted",
    "jobType",
    "isRemote",
    "jobLevel",
    "skills",
    "experienceRange",
    "companyIndustry",
    "applicationLink",
    "sourceJobId",
  ];
  for (const field of fields) {
    const val = job[field];
    if (val !== undefined && val !== null && val !== "") score++;
  }
  return score;
}

interface DedupKey {
  /** Source-specific ID key: source + sourceJobId. */
  sourceId: string | null;
  /** Canonical job URL. */
  url: string | null;
  /** Canonical application URL. */
  appUrl: string | null;
  /** Content fingerprint: employer + title + location. */
  content: string;
}

function computeKeys(job: CreateJobInput): DedupKey {
  const sourceId =
    job.sourceJobId && job.source ? `${job.source}:${job.sourceJobId}` : null;
  const url = normalizeUrl(job.jobUrl);
  const appUrl = normalizeUrl(job.applicationLink);
  const employer = normalizeEmployer(job.employer);
  const title = normalizeTitle(job.title);
  const location = normalizeLocation(job.location);
  const content = `${employer}|${title}|${location}`;
  return { sourceId, url, appUrl, content };
}

function isDuplicate(
  keys: DedupKey,
  existingKeys: DedupKey,
  existingJob: CreateJobInput,
  job: CreateJobInput,
): boolean {
  // Strong signals: exact match on source ID, URL, or application URL.
  if (keys.sourceId && keys.sourceId === existingKeys.sourceId) return true;
  if (keys.url && keys.url === existingKeys.url) return true;
  if (keys.appUrl && keys.appUrl === existingKeys.appUrl) return true;

  // Content fingerprint match: same employer + similar title + same location.
  if (keys.content === existingKeys.content) return true;

  // Fuzzy content match: same employer + high title similarity + same location.
  const empMatch =
    normalizeEmployer(job.employer) === normalizeEmployer(existingJob.employer);
  const locMatch =
    normalizeLocation(job.location) === normalizeLocation(existingJob.location);
  if (empMatch && locMatch) {
    const sim = titleSimilarity(job.title, existingJob.title);
    if (sim >= 0.85) {
      // Also verify description similarity if both have descriptions.
      const descA = descriptionFingerprint(job.jobDescription);
      const descB = descriptionFingerprint(existingJob.jobDescription);
      if (descA && descB) {
        const descSim =
          1 - levenshtein(descA, descB) / Math.max(descA.length, descB.length);
        return descSim >= 0.7;
      }
      return true;
    }
  }

  return false;
}

/**
 * Deduplicate jobs across and within sources.
 * Returns canonical jobs with merged source lists, and the count of removed duplicates.
 */
export function deduplicateJobs(jobs: CreateJobInput[]): DedupResult {
  const canonical: Array<CreateJobInput & { sources: string[] }> = [];
  const canonicalKeys: DedupKey[] = [];
  let duplicatesRemoved = 0;

  for (const job of jobs) {
    const keys = computeKeys(job);
    let foundDuplicate = false;

    for (let i = 0; i < canonical.length; i++) {
      if (isDuplicate(keys, canonicalKeys[i], canonical[i], job)) {
        // Merge: keep the record with higher completeness score.
        if (completenessScore(job) > completenessScore(canonical[i])) {
          canonical[i] = {
            ...job,
            sources: [...new Set([...canonical[i].sources, job.source])],
          };
        } else {
          canonical[i].sources = [
            ...new Set([...canonical[i].sources, job.source]),
          ];
        }
        duplicatesRemoved++;
        foundDuplicate = true;
        break;
      }
    }

    if (!foundDuplicate) {
      canonical.push({ ...job, sources: [job.source] });
      canonicalKeys.push(keys);
    }
  }

  return { jobs: canonical, duplicatesRemoved };
}
