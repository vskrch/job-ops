/**
 * Service for generating tailored resume content (Summary, Headline, Skills).
 */

import { logger } from "@infra/logger";
import type { ResumeProfile } from "@shared/types";
import { LlmService } from "./llm/service";
import type { JsonSchemaDefinition } from "./llm/types";
import { resolveLlmModel } from "./modelSelection";
import {
  getWritingLanguageLabel,
  resolveWritingOutputLanguage,
} from "./output-language";
import {
  getEffectivePromptTemplate,
  renderPromptTemplate,
} from "./prompt-templates";
import {
  getWritingStyle,
  stripKeywordLimitFromConstraints,
  stripLanguageDirectivesFromConstraints,
  stripWordLimitFromConstraints,
} from "./writing-style";

export interface TailoredBullet {
  /** Stable identifier matching the source experience entry (position+company+start). */
  id: string;
  /** Bullet text rewritten for this job. Same length-or-shorter than source. */
  text: string;
}

export interface TailoredExperienceEntry {
  id: string;
  bullets: TailoredBullet[];
}

export interface TailoredData {
  summary: string;
  headline: string;
  skills: Array<{ name: string; keywords: string[] }>;
  /** Optional per-experience bullet rewrites keyed by source entry id. */
  experienceBullets?: TailoredExperienceEntry[];
}

/**
 * Build a stable id for an experience entry from its contents, used to
 * thread tailoring output back into the rendered PDF.
 */
export function experienceEntryId(args: {
  company?: string | null;
  position?: string | null;
  startDate?: string | null;
}): string {
  return [args.company ?? "", args.position ?? "", args.startDate ?? ""]
    .join("|")
    .toLowerCase()
    .replace(/[^a-z0-9|]/g, "");
}

export interface TailoringResult {
  success: boolean;
  data?: TailoredData;
  error?: string;
}

/** JSON schema for resume tailoring response */
const TAILORING_SCHEMA: JsonSchemaDefinition = {
  name: "resume_tailoring",
  schema: {
    type: "object",
    properties: {
      headline: {
        type: "string",
        description: "Job title headline matching the JD exactly",
      },
      summary: {
        type: "string",
        description: "Tailored resume summary paragraph",
      },
      skills: {
        type: "array",
        description: "Skills sections with keywords tailored to the job",
        items: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Skill category name (e.g., Frontend, Backend)",
            },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "List of skills/technologies in this category",
            },
          },
          required: ["name", "keywords"],
          additionalProperties: false,
        },
      },
      experienceBullets: {
        type: "array",
        description:
          "Per-experience bullet rewrites. Each entry's id must match an experience id from MY PROFILE.",
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Stable identifier (company|position|startDate lowercased). Must match MY PROFILE exactly.",
            },
            bullets: {
              type: "array",
              description:
                "Rewritten bullets preserving the original count (or fewer) and ordering. Mirror source wording + keywords; do NOT invent.",
              items: {
                type: "object",
                properties: {
                  id: {
                    type: "string",
                    description:
                      "Stable id within this experience entry (index-based or first-40-chars hash).",
                  },
                  text: {
                    type: "string",
                    description: "Rewritten bullet text.",
                  },
                },
                required: ["text"],
                additionalProperties: false,
              },
            },
          },
          required: ["id", "bullets"],
          additionalProperties: false,
        },
      },
    },
    required: ["headline", "summary", "skills"],
    additionalProperties: false,
  },
};

/**
 * Generate tailored resume content (summary, headline, skills) for a job.
 */
export async function generateTailoring(
  jobDescription: string,
  profile: ResumeProfile,
): Promise<TailoringResult> {
  const [model, writingStyle] = await Promise.all([
    resolveLlmModel("tailoring"),
    getWritingStyle(),
  ]);
  const prompt = await buildTailoringPrompt(
    profile,
    jobDescription,
    writingStyle,
  );

  const llm = new LlmService();
  const result = await llm.callJson<TailoredData>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: TAILORING_SCHEMA,
  });

  if (!result.success) {
    const context = `provider=${llm.getProvider()} baseUrl=${llm.getBaseUrl()}`;
    if (result.error.toLowerCase().includes("api key")) {
      const message = `LLM API key not set, cannot generate tailoring. (${context})`;
      logger.warn(message);
      return { success: false, error: message };
    }
    return {
      success: false,
      error: `${result.error} (${context})`,
    };
  }

  const { summary, headline, skills, experienceBullets } = result.data;

  // Basic validation — treat missing required fields as a failed generation
  if (!summary || !headline || !Array.isArray(skills)) {
    logger.warn("AI response missing required tailoring fields", result.data);
    return {
      success: false,
      error:
        "AI response missing required tailoring fields (summary, headline, or skills)",
    };
  }

  // Normalize experienceBullets: keep only entries whose id matches a
  // known experience id and whose bullets are non-empty strings. Drop
  // the rest silently so malformed LLM output doesn't corrupt the resume.
  const safeExperienceBullets = Array.isArray(experienceBullets)
    ? experienceBullets
        .filter(
          (entry) =>
            entry &&
            typeof entry.id === "string" &&
            Array.isArray(entry.bullets),
        )
        .map((entry) => ({
          id: entry.id,
          bullets: entry.bullets
            .filter(
              (b) => b && typeof b.text === "string" && b.text.trim().length > 0,
            )
            .map((b) => ({
              id: typeof b.id === "string" ? b.id : `${entry.id}#?`,
              text: b.text,
            })),
        }))
        .filter((entry) => entry.bullets.length > 0)
    : undefined;

  return {
    success: true,
    data: {
      summary: sanitizeText(summary),
      headline: sanitizeText(headline),
      skills,
      experienceBullets: safeExperienceBullets,
    },
  };
}

/**
 * Backwards compatibility wrapper if needed, or alias.
 */
export async function generateSummary(
  jobDescription: string,
  profile: ResumeProfile,
): Promise<{ success: boolean; summary?: string; error?: string }> {
  // If we just need summary, we can discard the rest (or cache it? but here we just return summary)
  const result = await generateTailoring(jobDescription, profile);
  return {
    success: result.success,
    summary: result.data?.summary,
    error: result.error,
  };
}

async function buildTailoringPrompt(
  profile: ResumeProfile,
  jd: string,
  writingStyle: Awaited<ReturnType<typeof getWritingStyle>>,
): Promise<string> {
  const resolvedLanguage = resolveWritingOutputLanguage({
    style: writingStyle,
    profile,
  });
  const outputLanguage = getWritingLanguageLabel(resolvedLanguage.language);
  let effectiveConstraints = stripLanguageDirectivesFromConstraints(
    writingStyle.constraints,
  );
  if (writingStyle.summaryMaxWords != null) {
    effectiveConstraints = stripWordLimitFromConstraints(effectiveConstraints);
  }
  if (writingStyle.maxKeywordsPerSkill != null) {
    effectiveConstraints =
      stripKeywordLimitFromConstraints(effectiveConstraints);
  }

  const pRecord = profile as Record<string, unknown>;
  const rawProjects = Array.isArray(profile.sections?.projects?.items)
    ? profile.sections?.projects?.items
    : Array.isArray(pRecord.projects)
      ? (pRecord.projects as unknown[])
      : [];

  const rawExperience = Array.isArray(profile.sections?.experience?.items)
    ? profile.sections?.experience?.items
    : Array.isArray(pRecord.experience)
      ? (pRecord.experience as unknown[])
      : Array.isArray(pRecord.work)
        ? (pRecord.work as unknown[])
        : [];

  const rawSkills = profile.sections?.skills ?? pRecord.skills ?? null;

  // Extract only needed parts of profile to save tokens
  const relevantProfile = {
    basics: {
      name: profile.basics?.name,
      label: profile.basics?.label, // Original headline
      summary: profile.basics?.summary,
    },
    skills: rawSkills,
    projects: rawProjects.map((p) => {
      const item = p as Record<string, unknown>;
      return {
        name: String(item.name || ""),
        description: item.description ? String(item.description) : undefined,
        keywords: item.keywords as string[] | undefined,
      };
    }),
    experience: rawExperience.map((e) => {
      const item = e as Record<string, unknown>;
      const company = String(item.company || item.name || "");
      const position = String(item.position || item.role || "");
      const startDate = String(item.startDate || "");
      const id = experienceEntryId({ company, position, startDate });
      const rawBullets = Array.isArray(item.bullets)
        ? (item.bullets as unknown[]).filter(
            (b): b is string => typeof b === "string" && b.trim().length > 0,
          )
        : [];
      const summaryText =
        item.summary || item.description
          ? String(item.summary || item.description)
          : undefined;
      // If the LLM/parser preserved bullets, send them as the canonical
      // list. Otherwise fall back to splitting the summary on newlines
      // so the tailoring LLM still sees discrete achievements.
      const bullets =
        rawBullets.length > 0
          ? rawBullets
          : (summaryText
              ? summaryText
                  .split(/\r?\n/)
                  .map((line) =>
                    line.replace(/^\s*[•\-*●◦▪]\s*/, "").trim(),
                  )
                  .filter((line) => line.length > 0)
              : []);
      return {
        id,
        company,
        position,
        summary:
          bullets.length === 0 && summaryText ? summaryText : undefined,
        bullets: bullets.map((text, index) => ({
          id: `${id}#${index}`,
          text,
        })),
      };
    }),
  };

  const template = await getEffectivePromptTemplate("tailoringPromptTemplate");

  return renderPromptTemplate(template, {
    jobDescription: jd,
    profileJson: JSON.stringify(relevantProfile, null, 2),
    outputLanguage,
    tone: writingStyle.tone,
    formality: writingStyle.formality,
    summaryMaxWordsLine:
      writingStyle.summaryMaxWords != null
        ? ` Maximum ${writingStyle.summaryMaxWords} ${writingStyle.summaryMaxWords === 1 ? "word" : "words"}.`
        : "",
    maxKeywordsPerSkillLine:
      writingStyle.maxKeywordsPerSkill != null
        ? `\n   - Maximum ${writingStyle.maxKeywordsPerSkill} ${writingStyle.maxKeywordsPerSkill === 1 ? "keyword" : "keywords"} per category. If a category has more, keep only the most JD-relevant ones.`
        : "",
    constraintsBullet: effectiveConstraints
      ? `- Additional constraints: ${effectiveConstraints}`
      : "",
    avoidTermsBullet: writingStyle.doNotUse
      ? `- Avoid these words or phrases: ${writingStyle.doNotUse}`
      : "",
  });
}

function sanitizeText(text: string): string {
  return text
    .replace(/\*\*[\s\S]*?\*\*/g, "") // remove markdown bold
    .trim();
}
