/**
 * Service for scoring job suitability using AI.
 */

import { logger } from "@infra/logger";
import { getDefaultPromptTemplate } from "@shared/prompt-template-definitions.js";
import type { Job } from "@shared/types";
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

  // Apply salary penalty if enabled
  const penaltyResult = applySalaryPenalty(job, clampedScore, clampedReason, {
    penalizeMissingSalary: settings.penalizeMissingSalary.value,
    missingSalaryPenalty: settings.missingSalaryPenalty.value,
  });

  // Grade/verdict must be derived from the FINAL (post-penalty) score so the
  // displayed grade matches the returned numeric score. Using the pre-penalty
  // score here made AI-computed results diverge from the mock-scoring path.
  const clampedGrade = validGrades.includes(grade)
    ? grade
    : scoreToGrade(penaltyResult.score);
  const clampedVerdict = validVerdicts.includes(verdict)
    ? verdict
    : scoreToVerdict(penaltyResult.score);

  return {
    score: penaltyResult.score,
    reason: penaltyResult.reason,
    grade: clampedGrade,
    topProject: cleanTopProject,
    verdict: clampedVerdict,
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
  return renderPromptTemplate(preferences.promptTemplate, {
    profileJson: JSON.stringify(profile, null, 2),
    jobTitle: job.title,
    employer: job.employer,
    location: job.location || "Not specified",
    salary: job.salary || "Not specified",
    degreeRequired: job.degreeRequired || "Not specified",
    disciplines: job.disciplines || "Not specified",
    jobDescription: job.jobDescription || "No description available",
    scoringInstructionsText: preferences.instructions
      ? preferences.instructions
      : "No additional custom scoring instructions.",
  });
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

  return {
    score: penaltyResult.score,
    reason: penaltyResult.reason,
    grade: scoreToGrade(penaltyResult.score),
    topProject: null,
    verdict: scoreToVerdict(penaltyResult.score),
  };
}

import { asyncPool } from "@server/utils/async-pool";

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
    }
  >
> {
  const scoredJobs = await asyncPool({
    items: jobs,
    concurrency: SCORE_AND_RANK_CONCURRENCY,
    task: async (job) => {
      const { score, reason, grade, topProject, verdict } =
        await scoreJobSuitability(job, profile);
      return {
        ...job,
        suitabilityScore: score,
        suitabilityReason: reason,
        matchGrade: grade,
        topProject,
        matchVerdict: verdict,
      };
    },
  });

  return scoredJobs.sort((a, b) => b.suitabilityScore - a.suitabilityScore);
}
