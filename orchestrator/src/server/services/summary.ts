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

export interface TailoredData {
  summary: string;
  headline: string;
  skills: Array<{ name: string; keywords: string[] }>;
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

  const { summary, headline, skills } = result.data;

  // Basic validation — treat missing required fields as a failed generation
  if (!summary || !headline || !Array.isArray(skills)) {
    logger.warn("AI response missing required tailoring fields", result.data);
    return {
      success: false,
      error:
        "AI response missing required tailoring fields (summary, headline, or skills)",
    };
  }

  return {
    success: true,
    data: {
      summary: sanitizeText(summary),
      headline: sanitizeText(headline),
      skills,
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
      return {
        company: String(item.company || item.name || ""),
        position: String(item.position || item.role || ""),
        summary:
          item.summary || item.description
            ? String(item.summary || item.description)
            : undefined,
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
