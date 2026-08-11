/**
 * Strict constraint filtering for job search results.
 *
 * Deterministic enforcement of explicit user constraints. Never uses LLM.
 * When information is insufficient to verify a constraint, marks it as
 * "unknown" rather than assuming it matches.
 */

import type { CreateJobInput, ParsedSearchSpec } from "@shared/types";

export interface FilterResult {
  job: CreateJobInput;
  passed: boolean;
  filterReason: string | null;
  verifiedConstraints: string[];
  unverifiedConstraints: string[];
}

function normalize(str: string | null | undefined): string {
  return (str ?? "").toLowerCase().trim();
}

const ROLE_TOKEN_BLACKLIST = new Set([
  "senior",
  "junior",
  "lead",
  "staff",
  "principal",
  "engineer",
  "engineers",
  "developer",
  "developers",
  "manager",
  "architect",
  "specialist",
  "analyst",
  "consultant",
  "intern",
  "associate",
  "the",
  "a",
  "an",
]);

function tokenizeRole(value: string): string[] {
  return normalize(value)
    .split(/[^a-z0-9+#.]+/)
    .filter((t) => t.length > 1 && !ROLE_TOKEN_BLACKLIST.has(t));
}

function titleMatches(jobTitle: string, requestedRoles: string[]): boolean {
  const normalizedTitle = normalize(jobTitle);
  return requestedRoles.some((role) => {
    const normalizedRole = normalize(role);
    if (!normalizedRole) return false;
    // Exact substring match (fast path).
    if (normalizedTitle.includes(normalizedRole)) return true;
    // Token-overlap match: "software engineer" matches "Senior Software Developer"
    // because both share the meaningful token "software".
    const roleTokens = tokenizeRole(normalizedRole);
    if (roleTokens.length === 0) return false;
    const titleTokens = new Set(
      normalizedTitle.split(/[^a-z0-9+#.]+/).filter((t) => t.length > 1),
    );
    return roleTokens.every((t) => titleTokens.has(t));
  });
}

function matchesWorkMode(
  job: CreateJobInput,
  workMode: ParsedSearchSpec["workMode"],
): { matches: boolean; verified: boolean } {
  if (workMode === "any") return { matches: true, verified: true };

  // If isRemote is available, use it as the primary signal.
  if (job.isRemote !== undefined && job.isRemote !== null) {
    if (workMode === "remote") return { matches: job.isRemote, verified: true };
    if (workMode === "onsite")
      return { matches: !job.isRemote, verified: true };
    if (workMode === "hybrid") {
      return {
        matches: !job.isRemote,
        verified: false,
      };
    }
  }

  // Fall back to workFromHomeType field.
  const wfh = normalize(job.workFromHomeType);
  if (wfh) {
    if (workMode === "remote" && wfh === "remote")
      return { matches: true, verified: true };
    if (workMode === "hybrid" && wfh === "hybrid")
      return { matches: true, verified: true };
    if (workMode === "onsite" && (wfh === "onsite" || wfh === "office"))
      return { matches: true, verified: true };
  }

  // Cannot verify — don't reject, mark as unknown.
  return { matches: true, verified: false };
}

function parsePostedDate(job: CreateJobInput): Date | null {
  const dateStr = job.datePosted;
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Number.isNaN(d.getTime()) ? null : d;
}

function getFreshnessWindow(
  spec: ParsedSearchSpec,
): { start: Date; end: Date } | null {
  const { value, unit } = spec.postedWithin;
  if (value === null || unit === null) return null;

  const now = new Date();
  const start = new Date(now);
  if (unit === "hours") start.setHours(start.getHours() - value);
  else if (unit === "days") start.setDate(start.getDate() - value);
  else if (unit === "weeks") start.setDate(start.getDate() - value * 7);
  else return null;

  return { start, end: now };
}

function matchesExperience(
  job: CreateJobInput,
  spec: ParsedSearchSpec,
): { matches: boolean; verified: boolean } {
  const { minYears, maxYears } = spec.experience;
  if (minYears === null && maxYears === null) {
    return { matches: true, verified: true };
  }

  // Try to parse experience range from the job's experienceRange field.
  const expRange = normalize(job.experienceRange);
  if (expRange) {
    const minMatch = expRange.match(/(\d+)\s*\+?\s*years?/);
    const rangeMatch = expRange.match(/(\d+)\s*[-–]\s*(\d+)\s*years?/);
    let jobMin: number | null = null;
    let jobMax: number | null = null;
    if (rangeMatch) {
      jobMin = Number.parseInt(rangeMatch[1], 10);
      jobMax = Number.parseInt(rangeMatch[2], 10);
    } else if (minMatch) {
      jobMin = Number.parseInt(minMatch[1], 10);
    }

    if (jobMin !== null) {
      if (maxYears !== null && jobMin > maxYears)
        return { matches: false, verified: true };
      if (minYears !== null && jobMax !== null && jobMax < minYears)
        return { matches: false, verified: true };
      return { matches: true, verified: true };
    }
  }

  // Also check jobLevel for seniority-based inference.
  const level = normalize(job.jobLevel);
  if (level && minYears !== null) {
    if (level.includes("entry") && minYears > 2)
      return { matches: false, verified: false };
    if (level.includes("senior") && minYears > 5)
      return { matches: false, verified: false };
  }

  // Cannot verify from available data.
  return { matches: true, verified: false };
}

function matchesLocation(
  job: CreateJobInput,
  spec: ParsedSearchSpec,
): { matches: boolean; verified: boolean } {
  const { country, cities } = spec.location;
  const jobLocation = normalize(job.location);

  if (!country && cities.length === 0) return { matches: true, verified: true };

  // Remote-friendly locations ("Remote", "Anywhere", "Remote (US)") are
  // accepted for any country/city — they are explicitly location-agnostic.
  if (jobLocation && /\b(remote|anywhere|worldwide|global)\b/.test(jobLocation))
    return { matches: true, verified: false };

  if (jobLocation) {
    if (country) {
      const countryLower = country.toLowerCase();
      const aliases: Record<string, string[]> = {
        canada: ["ca", "toronto", "vancouver", "montreal", "calgary", "ottawa"],
        "united states": ["usa", "us", "america", "remote (us)"],
        india: ["in", "bengaluru", "bangalore", "mumbai", "delhi", "pune"],
      };
      const aliasList = aliases[countryLower] ?? [];
      const countryMatch =
        jobLocation.includes(countryLower) ||
        aliasList.some((a) => jobLocation.includes(a));
      if (!countryMatch && cities.length === 0)
        return { matches: false, verified: true };
    }
    if (cities.length > 0) {
      const cityMatch = cities.some((city) =>
        jobLocation.includes(city.toLowerCase()),
      );
      if (!cityMatch) return { matches: false, verified: true };
    }
    return { matches: true, verified: true };
  }

  return { matches: true, verified: false };
}

function matchesSalary(
  job: CreateJobInput,
  spec: ParsedSearchSpec,
): { matches: boolean; verified: boolean } {
  const { min, max } = spec.salary;
  if (min === null && max === null) return { matches: true, verified: true };

  // Check structured salary fields first.
  if (job.salaryMinAmount !== undefined && job.salaryMinAmount !== null) {
    if (min !== null && job.salaryMinAmount < min)
      return { matches: false, verified: true };
    if (max !== null && job.salaryMinAmount > max)
      return { matches: false, verified: true };
    return { matches: true, verified: true };
  }

  // Try parsing the salary string.
  const salaryStr = normalize(job.salary);
  if (salaryStr) {
    const numbers = salaryStr.match(/[\d,]+(?:\.\d+)?/g);
    if (numbers && numbers.length > 0) {
      const firstNum = Number.parseFloat(numbers[0].replace(/,/g, ""));
      if (Number.isFinite(firstNum)) {
        if (min !== null && firstNum < min)
          return { matches: false, verified: true };
        if (max !== null && firstNum > max)
          return { matches: false, verified: true };
        return { matches: true, verified: true };
      }
    }
  }

  return { matches: true, verified: false };
}

function matchesExcludeTerms(
  job: CreateJobInput,
  excludeTerms: string[],
): { matches: boolean; verified: boolean } {
  if (excludeTerms.length === 0) return { matches: true, verified: true };

  const titleLower = normalize(job.title);
  const descLower = normalize(job.jobDescription);
  const skillsLower = normalize(job.skills);

  for (const term of excludeTerms) {
    const termLower = normalize(term);
    if (!termLower) continue;
    if (
      titleLower.includes(termLower) ||
      descLower.includes(termLower) ||
      skillsLower.includes(termLower)
    ) {
      return { matches: false, verified: true };
    }
  }
  return { matches: true, verified: true };
}

function matchesEmploymentType(
  job: CreateJobInput,
  spec: ParsedSearchSpec,
): { matches: boolean; verified: boolean } {
  if (spec.employmentType === null) return { matches: true, verified: true };

  const jobType = normalize(job.jobType);
  if (!jobType) return { matches: true, verified: false };

  const specType = spec.employmentType.replace(/_/g, " ");
  if (jobType.includes(specType) || jobType.includes(spec.employmentType))
    return { matches: true, verified: true };

  // Common mismatches.
  if (spec.employmentType === "full_time" && jobType.includes("full"))
    return { matches: true, verified: true };
  if (spec.employmentType === "part_time" && jobType.includes("part"))
    return { matches: true, verified: true };
  if (spec.employmentType === "contract" && jobType.includes("contract"))
    return { matches: true, verified: true };

  return { matches: false, verified: true };
}

/**
 * Apply strict filtering to a list of jobs.
 * Returns each job with its pass/fail status, verified and unverified constraints.
 */
export function filterJobs(
  jobs: CreateJobInput[],
  spec: ParsedSearchSpec,
): FilterResult[] {
  const freshnessWindow = getFreshnessWindow(spec);
  const requestedRoles = spec.roles.filter((r) => r.trim());

  return jobs.map((job) => {
    const verified: string[] = [];
    const unverified: string[] = [];
    const failures: string[] = [];

    // Role matching
    if (requestedRoles.length > 0) {
      if (titleMatches(job.title, requestedRoles)) {
        verified.push("roles");
      } else {
        failures.push("roles");
      }
    }

    // Location matching
    const locResult = matchesLocation(job, spec);
    if (locResult.verified) {
      if (locResult.matches) verified.push("location");
      else failures.push("location");
    } else {
      unverified.push("location");
    }

    // Work mode matching
    const wmResult = matchesWorkMode(job, spec.workMode);
    if (wmResult.verified) {
      if (wmResult.matches) verified.push("workMode");
      else failures.push("workMode");
    } else {
      unverified.push("workMode");
    }

    // Experience matching
    const expResult = matchesExperience(job, spec);
    if (expResult.verified) {
      if (expResult.matches) verified.push("experience");
      else failures.push("experience");
    } else {
      unverified.push("experience");
    }

    // Salary matching
    const salResult = matchesSalary(job, spec);
    if (salResult.verified) {
      if (salResult.matches) verified.push("salary");
      else failures.push("salary");
    } else {
      unverified.push("salary");
    }

    // Employment type matching
    const etResult = matchesEmploymentType(job, spec);
    if (etResult.verified) {
      if (etResult.matches) verified.push("employmentType");
      else failures.push("employmentType");
    } else {
      unverified.push("employmentType");
    }

    // Exclude terms
    const excResult = matchesExcludeTerms(job, spec.excludeTerms);
    if (!excResult.matches) {
      failures.push("excludeTerms");
    }

    // Freshness
    if (freshnessWindow) {
      const postedDate = parsePostedDate(job);
      if (postedDate) {
        if (
          postedDate >= freshnessWindow.start &&
          postedDate <= freshnessWindow.end
        ) {
          verified.push("postedWithin");
        } else {
          failures.push("postedWithin");
        }
      } else {
        unverified.push("postedWithin");
      }
    }

    const passed = failures.length === 0;
    return {
      job,
      passed,
      filterReason: passed ? null : `Failed: ${failures.join(", ")}`,
      verifiedConstraints: verified,
      unverifiedConstraints: unverified,
    };
  });
}

/**
 * Calculate the freshness window for the report.
 */
export function computeFreshnessWindow(
  spec: ParsedSearchSpec,
  removedCount: number,
): {
  requested: string | null;
  effectiveStart: string | null;
  effectiveEnd: string | null;
  removedByFreshness: number;
} {
  const window = getFreshnessWindow(spec);
  const requested =
    spec.postedWithin.value !== null && spec.postedWithin.unit !== null
      ? `last ${spec.postedWithin.value} ${spec.postedWithin.unit}`
      : null;
  return {
    requested,
    effectiveStart: window?.start.toISOString() ?? null,
    effectiveEnd: window?.end.toISOString() ?? null,
    removedByFreshness: removedCount,
  };
}
