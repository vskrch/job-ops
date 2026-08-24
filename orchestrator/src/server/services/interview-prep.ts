/**
 * Interview prep pack generator (B1).
 *
 * Assembles a stage-appropriate pack from the job's tailored artifacts,
 * prior stage events, and the profile's STAR bank. Mock-interview mode is
 * a ghostwriter system-prompt preset (not a separate LLM tool).
 */

import type { Job, StarExample } from "@shared/types";

export const MOCK_INTERVIEW_SYSTEM_PRESET = `You are the interviewer for this job. Conduct a mock interview following the roleplay protocol: warm-up first, then role-specific technical questions, 1-2 behavioral questions tied to the posting's competencies, and one tough question or curveball. After each answer, give brief feedback — what worked, what to sharpen, and which STAR example from the pack would have served better. Never invent experience for the candidate.`;

export function buildPrepPackMarkdown(args: {
  job: Job;
  stage: string;
  interviewerNames: string[] | null;
  format: string | null;
  starExamples: StarExample[];
  priorFeedback: string[];
}): string {
  const { job, stage, starExamples, priorFeedback } = args;
  const interviewers =
    args.interviewerNames && args.interviewerNames.length > 0
      ? args.interviewerNames.join(", ")
      : "Not specified";
  const likelyQuestions: string[] = [];
  if (priorFeedback.length > 0)
    likelyQuestions.push(
      ...priorFeedback.map((f) => `Follow-up on prior feedback: ${f}`),
    );
  if (job.scoreBreakdown?.gaps?.length)
    likelyQuestions.push(
      ...job.scoreBreakdown.gaps.map((g) => `Bridge gap: ${g}`),
    );
  if (job.jobDescription)
    likelyQuestions.push(
      ...job.jobDescription
        .split("\n")
        .slice(0, 2)
        .filter(Boolean)
        .map((l) => `Posting requirement: ${l.trim().slice(0, 120)}`),
    );
  // Clamp to a handful so the pack is readable.
  const questions = likelyQuestions.slice(0, 8);

  const starSection =
    starExamples.length > 0
      ? starExamples
          .map(
            (s) =>
              `- **${s.title}** — use for: ${s.useFor.join(", ")}\n  S: ${s.situation.slice(0, 200)}\n  T: ${s.task.slice(0, 200)}\n  A: ${s.action.slice(0, 200)}\n  R: ${s.result.slice(0, 200)}`,
          )
          .join("\n\n")
      : "_Add STAR stories in Career preferences to map them here._";

  const consistency =
    job.tailoredSummary || job.suitabilityReason
      ? `- Claims the interviewer read:\n${[
          job.tailoredSummary,
          job.suitabilityReason,
        ]
          .filter(Boolean)
          .map((t) => `  - ${String(t).slice(0, 260)}`)
          .join(
            "\n",
          )}\n- Rule: no claim in the room that isn't on the paper, and every claim on paper defensible in depth.`
      : "_No tailored claims on file — add them via the pipeline before the interview._";

  return [
    `# Interview prep — ${stage}`,
    `**Job:** ${job.title} @ ${job.employer}`,
    `**Format:** ${args.format ?? "Not specified"} | **Interviewers:** ${interviewers}`,
    "",
    "## 1. Likely questions",
    ...questions.map((q) => `- ${q}`),
    "",
    "## 2. STAR mapping",
    starSection,
    "",
    "## 3. Consistency brief",
    consistency,
    "",
    "## 4. Tough questions (customized)",
    `- Why this company specifically? (anchor to verified hooks; never generic)`,
    `- You don't have [gap from §1] — bridge via adjacent experience + learning path.`,
    "",
    "## 5. Questions to ask",
    `- How does this team define success in the first 90 days?`,
    `- What is the biggest current challenge in this area?`,
    `- How is work divided and reviewed?`,
    "",
    "## 6. Logistics",
    `- Bring STAR cards, glass of water; take 5s before answering; close with "anything else you'd like to know about my background?"`,
  ].join("\n");
}
