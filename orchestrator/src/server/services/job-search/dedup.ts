/**
 * Multi-signal indexed deduplication for jobs from multiple sources (ADR-008 SE-016).
 *
 * Uses Map-based indexed lookup across:
 * 1. Source job ID (`${source}:${sourceJobId}`)
 * 2. Normalized direct job URL
 * 3. Normalized application URL
 * 4. Content fingerprint (`${employer}|${title}|${location}`)
 * 5. Employer-scoped fuzzy title similarity
 *
 * Reduces deduplication time from O(n²) to O(n) amortized.
 */

import type { CreateJobInput } from "@shared/types";

export interface DedupResult {
  /** Canonical jobs after dedup. */
  jobs: Array<CreateJobInput & { sources: string[] }>;
  /** Number of duplicate records removed. */
  duplicatesRemoved: number;
}

export function normalizeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
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

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeEmployer(employer: string): string {
  return employer
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeLocation(location: string | undefined): string {
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

export interface DedupKey {
  sourceId: string | null;
  url: string | null;
  appUrl: string | null;
  content: string;
  employer: string;
  location: string;
}

export function computeKeys(job: CreateJobInput): DedupKey {
  const sourceId =
    job.sourceJobId && job.source ? `${job.source}:${job.sourceJobId}` : null;
  const url = normalizeUrl(job.jobUrl);
  const appUrl = normalizeUrl(job.applicationLink);
  const employer = normalizeEmployer(job.employer);
  const title = normalizeTitle(job.title);
  const location = normalizeLocation(job.location);
  const content = `${employer}|${title}|${location}`;
  return { sourceId, url, appUrl, content, employer, location };
}

/**
 * Fast O(1) Index for matching duplicates.
 */
class DedupIndex {
  private bySourceId = new Map<string, number>();
  private byUrl = new Map<string, number>();
  private byAppUrl = new Map<string, number>();
  private byContent = new Map<string, number>();
  private byEmployer = new Map<string, number[]>();

  public findDuplicateIndex(
    keys: DedupKey,
    canonical: Array<CreateJobInput & { sources: string[] }>,
    job: CreateJobInput,
  ): number | null {
    // 1. Exact matches (O(1))
    if (keys.sourceId) {
      const idx = this.bySourceId.get(keys.sourceId);
      if (idx !== undefined) return idx;
    }
    if (keys.url) {
      const idx = this.byUrl.get(keys.url);
      if (idx !== undefined) return idx;
    }
    if (keys.appUrl) {
      const idx = this.byAppUrl.get(keys.appUrl);
      if (idx !== undefined) return idx;
    }
    if (keys.content) {
      const idx = this.byContent.get(keys.content);
      if (idx !== undefined) return idx;
    }

    // 2. Fuzzy matches scoped strictly to same employer candidates (small array)
    const employerMatches = this.byEmployer.get(keys.employer);
    if (employerMatches && employerMatches.length > 0) {
      for (const idx of employerMatches) {
        const candidate = canonical[idx];
        if (normalizeLocation(candidate.location) === keys.location) {
          const sim = titleSimilarity(job.title, candidate.title);
          if (sim >= 0.85) {
            const descA = descriptionFingerprint(job.jobDescription);
            const descB = descriptionFingerprint(candidate.jobDescription);
            if (descA && descB) {
              const descSim =
                1 -
                levenshtein(descA, descB) /
                  Math.max(descA.length, descB.length);
              if (descSim >= 0.7) return idx;
            } else {
              return idx;
            }
          }
        }
      }
    }

    return null;
  }

  public add(keys: DedupKey, index: number): void {
    if (keys.sourceId) this.bySourceId.set(keys.sourceId, index);
    if (keys.url) this.byUrl.set(keys.url, index);
    if (keys.appUrl) this.byAppUrl.set(keys.appUrl, index);
    this.byContent.set(keys.content, index);

    if (keys.employer) {
      const existing = this.byEmployer.get(keys.employer) || [];
      existing.push(index);
      this.byEmployer.set(keys.employer, existing);
    }
  }
}

/**
 * Deduplicate jobs across and within sources using an indexed O(n) pass.
 * Returns canonical jobs with merged source lists, and the count of removed duplicates.
 */
export function deduplicateJobs(jobs: CreateJobInput[]): DedupResult {
  const canonical: Array<CreateJobInput & { sources: string[] }> = [];
  const index = new DedupIndex();
  let duplicatesRemoved = 0;

  for (const job of jobs) {
    const keys = computeKeys(job);
    const dupIdx = index.findDuplicateIndex(keys, canonical, job);

    if (dupIdx !== null) {
      // Merge: keep record with higher completeness score
      if (completenessScore(job) > completenessScore(canonical[dupIdx])) {
        canonical[dupIdx] = {
          ...job,
          sources: [...new Set([...canonical[dupIdx].sources, job.source])],
        };
      } else {
        canonical[dupIdx].sources = [
          ...new Set([...canonical[dupIdx].sources, job.source]),
        ];
      }
      duplicatesRemoved++;
    } else {
      const newIdx = canonical.length;
      canonical.push({ ...job, sources: [job.source] });
      index.add(keys, newIdx);
    }
  }

  return { jobs: canonical, duplicatesRemoved };
}
