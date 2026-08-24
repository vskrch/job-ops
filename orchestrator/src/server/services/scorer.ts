/**
 * Service for scoring job suitability using AI.
 */

import { logger } from "@infra/logger";
import { asyncPool } from "@server/utils/async-pool";
import { getDefaultPromptTemplate } from "@shared/prompt-template-definitions.js";
import type { GateVerdict, ScoreBreakdown } from "@shared/score-breakdown";
import { computeWeightedOverall } from "@shared/score-breakdown";
import type { Job } from "@shared/types";
import {
  sanitizeUntrustedText,
  withTrustBoundary,
} from "@shared/untrusted-content";
import type { JsonSchemaDefinition } from "./llm/types";
import { stripMarkdownCodeFences } from "./llm/utils/json";
import { createLlmClient } from "./modelSelection";
import { renderPromptTemplate } from "./prompt-templates";
import { getEffectiveSettings } from "./settings";

interface SuitabilityResult {
  score: number; // 0-100
  reason: string; // Explanation
  grade: string; // Letter grade A-F
  topProject: string | null; // Recommended project to highlight
  verdict: string; // "apply" | "maybe" | "skip"
  breakdown?: ScoreBreakdown | null;
}

type ScoringPreferences = {
  instructions: string;
  promptTemplate: string;
};

/** JSON schema for suitability scoring response */
const SCORING_SCHEMA: JsonSchemaDefinition = {
  name: "job_suitability_score",
  schema: {
    type: "object",
    properties: {
      score: {
        type: "integer",
        description: "Suitability score from 0 to 100",
      },
      reason: {
        type: "string",
        description: "Brief 1-2 sentence explanation of the score",
      },
      grade: {
        type: "string",
        enum: ["A", "B", "C", "D", "F"],
        description:
          "Letter grade: A (80-100, apply now), B (65-79, strong match), C (50-64, decent match), D (35-49, weak match), F (0-34, skip)",
      },
      topProject: {
        type: "string",
        description:
          "Name of the single project from the candidate's profile that best demonstrates fit for this role. Empty string if none.",
      },
      verdict: {
        type: "string",
        enum: ["apply", "maybe", "skip"],
        description:
          "Action verdict: apply (strong fit, apply now), maybe (partial fit, consider), skip (poor fit)",
      },
      technical: {
        type: "integer",
        description:
          "Fit with posting's required/preferred technologies (0-100). Used with experience/behavioral/career to derive the weighted overall.",
      },
      experience: {
        type: "integer",
        description:
          "Seniority/domain/role overlap (0-100), scored by function not just title.",
      },
      behavioral: {
        type: "integer",
        description:
          "Culture/team style compatibility (0-100), using thrives-on/drains from the profile.",
      },
      career: {
        type: "integer",
        description: "Career alignment / motivation fit (0-100).",
      },
      locationVerdict: {
        type: "string",
        enum: ["PASS", "FAIL", "FLAG"],
        description:
          "Location/logistics gate. FAIL means relocation without support. FLAG means friction but not a hard stop; PASS means no location blocker.",
      },
      locationNote: {
        type: "string",
        description:
          "Triggering posting line for a FAIL/FLAG location verdict, empty otherwise.",
      },
      languageGate: {
        type: "string",
        enum: ["PASS", "FAIL", "FLAG"],
        description:
          "Language requirement gate. FAIL = required language not declared at all (hard stop). FLAG = declared at a plausibly lower level. PASS = no blocker.",
      },
      languageNote: {
        type: "string",
        description:
          "Posting requirement + declared level for a FLAG/FAIL, empty on PASS.",
      },
      dealBreakerHit: {
        type: "boolean",
        description:
          "True when any profile deal-breaker appears as a stated posting requirement.",
      },
      dealBreakerNote: {
        type: "string",
        description: "Triggering line for a dealBreakerHit, empty otherwise.",
      },
      strengths: {
        type: "array",
        items: { type: "string" },
        description:
          "1-3 grounded strengths per this posting (what to lean into).",
      },
      gaps: {
        type: "array",
        items: { type: "string" },
        description:
          "1-3 honest gaps per this posting (request → bridge story).",
      },
    },
    required: ["score", "reason", "grade", "topProject", "verdict"],
    additionalProperties: false,
  },
};

/**
 * Check if a job's salary field is missing/empty.
 * Returns true for null, empty string, or whitespace-only strings.
 */
function isSalaryMissing(salary: string | null): boolean {
  return salary === null || salary.trim() === "";
}

/**
 * Apply salary penalty to a score if enabled.
 * Returns the adjusted score, adjusted reason, and whether penalty was applied.
 */
function applySalaryPenalty(
  job: Job,
  originalScore: number,
  originalReason: string,
  settings: { penalizeMissingSalary: boolean; missingSalaryPenalty: number },
): { score: number; reason: string; penaltyApplied: boolean } {
  if (!settings.penalizeMissingSalary || !isSalaryMissing(job.salary)) {
    return {
      score: originalScore,
      reason: originalReason,
      penaltyApplied: false,
    };
  }

  const penalty = settings.missingSalaryPenalty;
  const adjustedScore = Math.max(0, originalScore - penalty);
  const penaltyText = `Score reduced by ${penalty} points due to missing salary information.`;
  const adjustedReason = `${originalReason} ${penaltyText}`;

  logger.info("Applied salary penalty", {
    jobId: job.id,
    originalScore,
    penalty,
    finalScore: adjustedScore,
  });

  return { score: adjustedScore, reason: adjustedReason, penaltyApplied: true };
}

function scoreToGrade(score: number): string {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "F";
}

function scoreToVerdict(score: number): string {
  if (score >= 65) return "apply";
  if (score >= 40) return "maybe";
  return "skip";
}

function clampDim(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, Math.round(value)));
}

const GATE_SET = new Set<GateVerdict>(["PASS", "FAIL", "FLAG"]);

function normalizeGate(value: unknown): GateVerdict {
  if (typeof value === "string") {
    const upper = value.trim().toUpperCase() as GateVerdict;
    if (GATE_SET.has(upper)) return upper;
  }
  return "PASS";
}

function buildBreakdownFromRaw(raw: Record<string, unknown>): ScoreBreakdown {
  const technical = clampDim(raw.technical);
  const experience = clampDim(raw.experience);
  const behavioral = clampDim(raw.behavioral);
  const career = clampDim(raw.career);
  const derived = computeWeightedOverall(
    technical ?? 50,
    experience ?? 50,
    behavioral ?? 50,
    career ?? 50,
  );
  const scored = clampDim(raw.score) ?? derived;
  const overall = derived !== scored ? derived : scored;
  const strengthsRaw = Array.isArray(raw.strengths)
    ? (raw.strengths as string[])
    : [];
  const gapsRaw = Array.isArray(raw.gaps) ? (raw.gaps as string[]) : [];
  return {
    technical: technical ?? scored,
    experience: experience ?? scored,
    behavioral: behavioral ?? scored,
    career: career ?? scored,
    overall,
    locationVerdict: normalizeGate(raw.locationVerdict),
    locationNote:
      raw.locationNote && String(raw.locationNote).trim().length > 0
        ? String(raw.locationNote).trim().slice(0, 500)
        : null,
    languageGate: normalizeGate(raw.languageGate),
    languageNote:
      raw.languageNote && String(raw.languageNote).trim().length > 0
        ? String(raw.languageNote).trim().slice(0, 500)
        : null,
    dealBreakerHit: raw.dealBreakerHit === true,
    dealBreakerNote:
      raw.dealBreakerNote && String(raw.dealBreakerNote).trim().length > 0
        ? String(raw.dealBreakerNote).trim().slice(0, 500)
        : null,
    strengths: strengthsRaw
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 5),
    gaps: gapsRaw
      .map((s) => String(s).trim())
      .filter(Boolean)
      .slice(0, 5),
    evaluatedAt: new Date().toISOString(),
  };
}

function applyGateVeto(
  breakdown: ScoreBreakdown,
  clampedScore: number,
  clampedReason: string,
  clampedGrade: string,
  clampedVerdict: string,
): {
  score: number;
  reason: string;
  grade: string;
  verdict: string;
  breakdown: ScoreBreakdown;
} {
  const veto =
    breakdown.locationVerdict === "FAIL" ||
    breakdown.languageGate === "FAIL" ||
    breakdown.dealBreakerHit;
  if (!veto)
    return {
      score: clampedScore,
      reason: clampedReason,
      grade: clampedGrade,
      verdict: clampedVerdict,
      breakdown,
    };
  const noteParts = [
    breakdown.locationVerdict === "FAIL" && breakdown.locationNote
      ? `Location: ${breakdown.locationNote}`
      : null,
    breakdown.languageGate === "FAIL" && breakdown.languageNote
      ? `Language: ${breakdown.languageNote}`
      : null,
    breakdown.dealBreakerHit && breakdown.dealBreakerNote
      ? `Deal-breaker: ${breakdown.dealBreakerNote}`
      : null,
  ].filter(Boolean) as string[];
  const suffix =
    noteParts.length > 0 ? ` Veto — ${noteParts.join(" · ")}.` : "";
  return {
    score: Math.min(clampedScore, 34),
    reason: `${clampedReason}${suffix}`,
    grade: "F",
    verdict: "skip",
    breakdown,
  };
}

/**
 * Score a job's suitability based on profile and job description.
 * Includes retry logic for when AI returns garbage responses.
 */
export async function scoreJobSuitability(
  job: Job,
  profile: Record<string, unknown>,
): Promise<SuitabilityResult> {
  const [{ llm, model }, settings] = await Promise.all([
    createLlmClient("scoring"),
    getEffectiveSettings(),
  ]);

  const prompt = buildScoringPrompt(job, sanitizeProfileForPrompt(profile), {
    instructions: settings.scoringInstructions?.value ?? "",
    promptTemplate:
      settings.scoringPromptTemplate?.value ??
      getDefaultPromptTemplate("scoringPromptTemplate"),
  });

  const result = await llm.callJson<{
    score: number;
    reason: string;
    grade: string;
    topProject: string;
    verdict: string;
    technical?: number;
    experience?: number;
    behavioral?: number;
    career?: number;
    locationVerdict?: string;
    locationNote?: string;
    languageGate?: string;
    languageNote?: string;
    dealBreakerHit?: boolean;
    dealBreakerNote?: string;
    strengths?: string[];
    gaps?: string[];
  }>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: SCORING_SCHEMA,
    maxRetries: 2,
    jobId: job.id,
  });

  if (!result.success) {
    if (result.error.toLowerCase().includes("api key")) {
      logger.warn("LLM API key not set, using mock scoring", { jobId: job.id });
    }
    logger.error("Scoring failed, using mock scoring", {
      jobId: job.id,
      error: result.error,
    });
    return mockScore(job, {
      penalizeMissingSalary: settings.penalizeMissingSalary.value,
      missingSalaryPenalty: settings.missingSalaryPenalty.value,
    });
  }

  const { score, reason, grade, topProject, verdict } = result.data;

  // Validate we got a reasonable response
  if (typeof score !== "number" || Number.isNaN(score)) {
    logger.error("Invalid score in AI response, using mock scoring", {
      jobId: job.id,
    });
    return mockScore(job, {
      penalizeMissingSalary: settings.penalizeMissingSalary.value,
      missingSalaryPenalty: settings.missingSalaryPenalty.value,
    });
  }

  const clampedScore = Math.min(100, Math.max(0, Math.round(score)));
  const clampedReason = reason || "No explanation provided";
  const validGrades = ["A", "B", "C", "D", "F"];
  const validVerdicts = ["apply", "maybe", "skip"];
  const cleanTopProject = topProject?.trim() || null;

  // Structured breakdown from the LLM's dimension scores + gates. Falls
  // back to the blended score on early-model responses that omit dimensions.
  let breakdown = buildBreakdownFromRaw(
    result.data as unknown as Record<string, unknown>,
  );

  // Prefer the dimension-weighted overall when dimensions were returned;
  // that is the authoritative weighted score. Keep breakdown.overall aligned.
  const hasDimensions =
    typeof result.data.technical === "number" &&
    typeof result.data.experience === "number" &&
    typeof result.data.behavioral === "number" &&
    typeof result.data.career === "number";
  const derivedScore = hasDimensions ? breakdown.overall : clampedScore;
  if (hasDimensions) {
    breakdown = { ...breakdown, overall: derivedScore };
  }

  // Apply salary penalty if enabled (affects both the top-level score and
  // the breakdown's overall so UIs reading the breakdown stay consistent).
  const penaltyResult = applySalaryPenalty(job, derivedScore, clampedReason, {
    penalizeMissingSalary: settings.penalizeMissingSalary.value,
    missingSalaryPenalty: settings.missingSalaryPenalty.value,
  });
  if (penaltyResult.penaltyApplied) {
    breakdown = { ...breakdown, overall: penaltyResult.score };
  }

  // Grade/verdict must be derived from the FINAL (post-penalty / veto)
  // score so the displayed grade matches the returned numeric score.
  const clampedGrade = validGrades.includes(grade)
    ? grade
    : scoreToGrade(penaltyResult.score);
  const clampedVerdict = validVerdicts.includes(verdict)
    ? verdict
    : scoreToVerdict(penaltyResult.score);

  const vetoed = applyGateVeto(
    breakdown,
    penaltyResult.score,
    penaltyResult.reason,
    clampedGrade,
    clampedVerdict,
  );

  return {
    score: vetoed.score,
    reason: vetoed.reason,
    grade: vetoed.grade,
    topProject: cleanTopProject,
    verdict: vetoed.verdict,
    breakdown: vetoed.breakdown,
  };
}

/**
 * Robustly parse JSON from AI-generated content.
 * Handles common AI quirks: markdown fences, extra text, trailing commas, etc.
 *
 * @deprecated Use LlmService with structured outputs instead. Kept for backwards compatibility with tests.
 */
export function parseJsonFromContent(
  content: string,
  jobId?: string,
): { score?: number; reason?: string } {
  const originalContent = content;
  let candidate = content.trim();

  // Step 1: Remove markdown code fences (with or without language specifier)
  candidate = stripMarkdownCodeFences(candidate);

  // Step 2: Try to extract JSON object if there's surrounding text
  const jsonMatch = candidate.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    candidate = jsonMatch[0];
  }

  // Step 3: Try direct parse first
  try {
    return JSON.parse(candidate);
  } catch {
    // Continue with sanitization
  }

  // Step 4: Fix common JSON issues
  let sanitized = candidate;

  // Remove JavaScript-style comments (// and /* */)
  sanitized = sanitized.replace(/\/\/[^\n]*/g, "");
  sanitized = sanitized.replace(/\/\*[\s\S]*?\*\//g, "");

  // Remove trailing commas before } or ]
  sanitized = sanitized.replace(/,\s*([\]}])/g, "$1");

  // Fix unquoted keys: word: -> "word":
  // Be more careful - only match at start of object or after comma
  sanitized = sanitized.replace(
    /([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g,
    '$1"$2":',
  );

  // Fix single quotes to double quotes
  sanitized = sanitized.replace(/'/g, '"');

  // Remove ALL control characters (including newlines/tabs INSIDE string values which break JSON)
  // First, let's normalize the string - escape actual newlines inside strings
  // biome-ignore lint/suspicious/noControlCharactersInRegex: needed to fix broken JSON from AI
  const controlCharsRegex = /[\x00-\x1F\x7F]/g;
  sanitized = sanitized.replace(controlCharsRegex, (match) => {
    if (match === "\n") return "\\n";
    if (match === "\r") return "\\r";
    if (match === "\t") return "\\t";
    return "";
  });

  // Step 5: Try parsing the sanitized version
  try {
    return JSON.parse(sanitized);
  } catch {
    // Continue with more aggressive extraction
  }

  // Step 6: Even more aggressive - try to rebuild a minimal valid JSON
  // by extracting just the score and reason values
  const scoreMatch = originalContent.match(
    /["']?score["']?\s*[:=]\s*(\d+(?:\.\d+)?)/i,
  );
  const reasonMatch =
    originalContent.match(/["']?reason["']?\s*[:=]\s*["']([^"'\n]+)["']/i) ||
    originalContent.match(
      /["']?reason["']?\s*[:=]\s*["']?(.*?)["']?\s*[,}\n]/is,
    );

  if (scoreMatch) {
    const score = Math.round(parseFloat(scoreMatch[1]));
    const reason = reasonMatch
      ? reasonMatch[1].trim().replace(controlCharsRegex, "")
      : "Score extracted from malformed response";
    logger.warn("Parsed score via regex fallback", {
      jobId: jobId || "unknown",
      score,
    });
    return { score, reason };
  }

  // Log the failure with full content for debugging
  logger.error("Failed to parse AI response", {
    jobId: jobId || "unknown",
    rawSample: originalContent.substring(0, 500),
    sanitizedSample: sanitized.substring(0, 500),
  });

  throw new Error("Unable to parse JSON from model response");
}

function buildScoringPrompt(
  job: Job,
  profile: Record<string, unknown>,
  preferences: ScoringPreferences,
): string {
  const prompt = renderPromptTemplate(preferences.promptTemplate, {
    profileJson: JSON.stringify(profile, null, 2),
    jobTitle: sanitizeUntrustedText(job.title),
    employer: sanitizeUntrustedText(job.employer),
    location: sanitizeUntrustedText(job.location || "Not specified"),
    salary: sanitizeUntrustedText(job.salary || "Not specified"),
    degreeRequired: sanitizeUntrustedText(
      job.degreeRequired || "Not specified",
    ),
    disciplines: sanitizeUntrustedText(job.disciplines || "Not specified"),
    jobDescription: sanitizeUntrustedText(
      job.jobDescription || "No description available",
    ),
    scoringInstructionsText: preferences.instructions
      ? preferences.instructions
      : "No additional custom scoring instructions.",
  });
  return withTrustBoundary(prompt);
}

function sanitizeProfileForPrompt(
  profile: Record<string, unknown>,
): Record<string, unknown> {
  const p = profile as {
    basics?: Record<string, unknown>;
    sections?: {
      skills?: unknown;
      experience?: { items?: unknown[] };
      projects?: { items?: unknown[] };
      education?: { items?: unknown[] };
    };
    experience?: unknown[];
    work?: unknown[];
    projects?: unknown[];
    skills?: unknown;
    education?: unknown[];
    languageLevels?: Array<{ name: string; level: string | null }>;
    dealBreakers?: string[];
    careerGoals?: string[];
    behavioralNotes?: string | null;
    starExamples?: Array<{ title?: string; useFor?: string[] }>;
  };

  const experienceItems = Array.isArray(p.sections?.experience?.items)
    ? p.sections?.experience?.items.slice(0, 5)
    : Array.isArray(p.experience)
      ? p.experience.slice(0, 5)
      : Array.isArray(p.work)
        ? p.work.slice(0, 5)
        : [];

  const projectItems = Array.isArray(p.sections?.projects?.items)
    ? p.sections?.projects?.items.slice(0, 6)
    : Array.isArray(p.projects)
      ? p.projects.slice(0, 6)
      : [];

  const educationItems = Array.isArray(p.sections?.education?.items)
    ? p.sections?.education?.items
    : Array.isArray(p.education)
      ? p.education
      : [];

  const skillsData = p.sections?.skills ?? p.skills ?? null;

  return {
    basics: {
      name: p.basics?.name,
      label: p.basics?.label,
      summary: p.basics?.summary,
    },
    skills: skillsData,
    experience: experienceItems,
    projects: projectItems,
    education: educationItems,
    languageLevels: p.languageLevels ?? [],
    dealBreakers: p.dealBreakers ?? [],
    careerGoals: p.careerGoals ?? [],
    behavioralNotes: p.behavioralNotes ?? null,
    // Star examples trimmed to tags only for the scoring prompt (the
    // full text feeds interview prep, not scoring).
    starExampleTags:
      p.starExamples?.map((s) => ({
        title: s.title,
        useFor: s.useFor,
      })) ?? [],
  };
}

async function mockScore(
  job: Job,
  settings: { penalizeMissingSalary: boolean; missingSalaryPenalty: number },
): Promise<SuitabilityResult> {
  // Simple keyword-based scoring as fallback
  const jd = (job.jobDescription || "").toLowerCase();
  const title = job.title.toLowerCase();

  const goodKeywords = [
    "typescript",
    "react",
    "node",
    "python",
    "web",
    "frontend",
    "backend",
    "fullstack",
    "software",
    "engineer",
    "developer",
  ];
  const badKeywords = [
    "senior",
    "5+ years",
    "10+ years",
    "principal",
    "staff",
    "manager",
  ];

  let score = 50;

  for (const kw of goodKeywords) {
    if (jd.includes(kw) || title.includes(kw)) score += 5;
  }

  for (const kw of badKeywords) {
    if (jd.includes(kw) || title.includes(kw)) score -= 10;
  }

  score = Math.min(100, Math.max(0, score));

  const baseReason = "Scored using keyword matching (API key not configured)";

  // Apply salary penalty if enabled
  const penaltyResult = applySalaryPenalty(job, score, baseReason, settings);

  const breakdown: ScoreBreakdown = {
    technical: score,
    experience: score,
    behavioral: 50,
    career: 50,
    overall: penaltyResult.score,
    locationVerdict: "PASS",
    locationNote: null,
    languageGate: "PASS",
    languageNote: null,
    dealBreakerHit: false,
    dealBreakerNote: null,
    strengths:
      penaltyResult.score >= 60
        ? ["Keyword match with the posting's core stack"]
        : [],
    gaps:
      penaltyResult.score < 50 ? ["Position asks for senior experience"] : [],
    evaluatedAt: new Date().toISOString(),
  };

  return {
    score: penaltyResult.score,
    reason: penaltyResult.reason,
    grade: scoreToGrade(penaltyResult.score),
    topProject: null,
    verdict: scoreToVerdict(penaltyResult.score),
    breakdown,
  };
}

const SCORE_AND_RANK_CONCURRENCY = 4;

/**
 * Score multiple jobs and return sorted by score (descending).
 */
export async function scoreAndRankJobs(
  jobs: Job[],
  profile: Record<string, unknown>,
): Promise<
  Array<
    Job & {
      suitabilityScore: number;
      suitabilityReason: string;
      matchGrade: string;
      topProject: string | null;
      matchVerdict: string;
      scoreBreakdown: ScoreBreakdown | null;
    }
  >
> {
  const scoredJobs = await asyncPool({
    items: jobs,
    concurrency: SCORE_AND_RANK_CONCURRENCY,
    task: async (job) => {
      const { score, reason, grade, topProject, verdict, breakdown } =
        await scoreJobSuitability(job, profile);
      return {
        ...job,
        suitabilityScore: score,
        suitabilityReason: reason,
        matchGrade: grade,
        topProject,
        matchVerdict: verdict,
        scoreBreakdown: breakdown ?? null,
      };
    },
  });

  return scoredJobs.sort((a, b) => b.suitabilityScore - a.suitabilityScore);
}
