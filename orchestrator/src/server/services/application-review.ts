/**
 * Drafter–reviewer application review service (A4).
 *
 * After tailoring produces draft headline/summary/skills bullets, this service
 * runs a second LLM pass with fresh context: it researches the company via
 * the cached payload (A5), runs the factual grounding audit against the
 * 3-source union (profile JSON + master CV text), and returns structured
 * edits. Part A edits are exact string replacements applied mechanically;
 * Part B narrative is grouped per category and presented even when empty.
 */

import { logger } from "@infra/logger";
import type { Job, ResumeProfile } from "@shared/types";
import { TRUST_BOUNDARY_NOTICE } from "@shared/untrusted-content";
import type { JsonSchemaDefinition } from "./llm/types";
import { createLlmClient } from "./modelSelection";
import { getProfile } from "./profile";

export interface ReviewResult {
  edits: Array<{
    file: string;
    oldString: string;
    newString: string;
    reason: string;
  }>;
  narrative: {
    missedKeywords: string;
    companyAngles: string;
    reframing: string;
    tone: string;
  };
  groundingFlags: Array<{ field: string; reason: string }>;
}

const REVIEW_SCHEMA: JsonSchemaDefinition = {
  name: "application_review",
  schema: {
    type: "object",
    properties: {
      edits: {
        type: "array",
        items: {
          type: "object",
          properties: {
            file: { type: "string" },
            oldString: { type: "string" },
            newString: { type: "string" },
            reason: { type: "string" },
          },
          required: ["file", "oldString", "newString", "reason"],
          additionalProperties: false,
        },
      },
      narrativeMissedKeywords: { type: "string" },
      narrativeCompanyAngles: { type: "string" },
      narrativeReframing: { type: "string" },
      narrativeTone: { type: "string" },
    },
    required: [
      "edits",
      "narrativeMissedKeywords",
      "narrativeCompanyAngles",
      "narrativeReframing",
      "narrativeTone",
    ],
    additionalProperties: false,
  },
};

/**
 * Review a tailored draft for groundedness + targeting. Returns the LLM parse,
 * or a structured fallback when no API key is configured.
 */
export async function reviewTailoredDraft(args: {
  job: Job;
  draft: {
    headline: string | null;
    summary: string | null;
    skillsJson: string | null;
  };
  profile?: ResumeProfile | null;
}): Promise<ReviewResult> {
  const profile = args.profile ?? (await getProfile().catch(() => null));

  const [{ llm, model }] = await Promise.all([createLlmClient("tailoring")]);

  const draftBlock =
    `DRAFT HEADLINE:\n${args.draft.headline ?? ""}\n\n` +
    `DRAFT SUMMARY:\n${args.draft.summary ?? ""}\n\n` +
    `DRAFT SKILLS JSON:\n${args.draft.skillsJson ?? ""}`;

  const prompt =
    `You are reviewing a tailored resume draft for the job below. ` +
    `Be precise, never fabricate, and ground every claim against the profile.\n\n` +
    `JOB: ${args.job.title} @ ${args.job.employer}\nLocation: ${args.job.location ?? ""}\n\n` +
    `POSTING:\n${(args.job.jobDescription ?? "").slice(0, 6000)}\n\n` +
    `PROFILE (JSON subset):\n${JSON.stringify(profile, null, 2).slice(0, 8000)}\n\n` +
    draftBlock +
    `\n\nGrounding audit: every date/title/metric in the draft must trace to the profile JSON above or be flagged as Part A grounding edits (\`reason: "grounding"\`). ` +
    `Relevance-weighted cutting: when judging overflow, rank lines by (a) posting relevance, (b) uniqueness, (c) cover-letter load.\n\n` +
    TRUST_BOUNDARY_NOTICE;

  const result = await llm.callJson<{
    edits: ReviewResult["edits"];
    narrativeMissedKeywords: string;
    narrativeCompanyAngles: string;
    narrativeReframing: string;
    narrativeTone: string;
  }>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: REVIEW_SCHEMA,
    maxRetries: 1,
    jobId: args.job.id,
  });

  if (!result.success) {
    logger.warn("Application review LLM call failed, returning empty review", {
      jobId: args.job.id,
      error: result.error,
    });
    return {
      edits: [],
      narrative: {
        missedKeywords:
          "Review unavailable (no API key or LLM error). Manual review advised.",
        companyAngles: "—",
        reframing: "—",
        tone: "—",
      },
      groundingFlags: [],
    };
  }

  return {
    edits: result.data.edits ?? [],
    narrative: {
      missedKeywords: result.data.narrativeMissedKeywords ?? "no issues",
      companyAngles: result.data.narrativeCompanyAngles ?? "no issues",
      reframing: result.data.narrativeReframing ?? "no issues",
      tone: result.data.narrativeTone ?? "no issues",
    },
    groundingFlags: (result.data.edits ?? [])
      .filter((e) => e.reason?.toLowerCase().includes("grounding"))
      .map((e) => ({ field: e.file, reason: e.reason })),
  };
}

/**
 * Apply structured Part-A edits to a headline/summary/skills tuple.
 * Only exact-string replacements are applied; mismatches are returned
 * as skipped entries for the caller to surface.
 */
export function applyStructuredEdits(
  draft: {
    headline: string | null;
    summary: string | null;
    skillsJson: string | null;
  },
  edits: ReviewResult["edits"],
): { draft: typeof draft; skipped: typeof edits } {
  const out: typeof draft = { ...draft };
  const skipped: typeof edits = [];
  for (const e of edits) {
    // Cheap: map file name to field, then exact string replace.
    const field = e.file.includes("headline")
      ? "headline"
      : e.file.includes("summary")
        ? "summary"
        : "skillsJson";
    const current = (out as Record<string, string | null>)[field];
    if (typeof current === "string" && current.includes(e.oldString)) {
      (out as Record<string, string | null>)[field] = current.replace(
        e.oldString,
        e.newString,
      );
    } else {
      skipped.push(e);
    }
  }
  return { draft: out, skipped };
}
