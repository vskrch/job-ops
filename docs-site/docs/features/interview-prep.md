---
id: interview-prep
title: Interview prep
description: Stage-appropriate prep packs from tailored docs and prior feedback, STAR mapping, and mock-interview roleplay.
sidebar_position: 16
---

## What it is

- **Prep-pack generator:** `POST /api/interview-prep/generate` builds a markdown pack from the job's score breakdown + tailored artifacts, the stage column (applied → interview → offer), prior stage-event notes, and the profile's **STAR bank**. Output includes:
  1. Likely questions (priority: prior feedback → scoring gaps → posting excerpt → stage type),
  2. STAR mapping (`useFor` tags),
  3. Consistency brief — claims the interviewer read (`tailoredSummary`, `suitabilityReason`) that must be defensible in depth,
  4. Customized tough questions with verified company hooks (when `company-research` is available),
  5. Questions-to-ask for the candidate,
  6. Logistics (format, interviewer names, 90-day success framing).

- **Storage:** `application_artifacts` rows of `kind='prep_pack'` (one per stage, append-only), listed by `GET /api/interview-prep/:jobId`.

- **Mock interview:** a Ghostwriter system-prompt preset (`MOCK_INTERVIEW_SYSTEM_PRESET`) that ports the source roleplay protocol — warm-up, role-specific technical questions, behavioral probes tied to the posting's competencies, one curveball, and post-answer STAR-aware feedback.

## Why it exists

Packs save operator setup and keep interviews grounded in the submitted materials (the "no claim in the room that isn't on the paper" rule).

## How to use it

1. From a tracked application, call `POST /api/interview-prep/generate` with `{ jobId, stage, interviewerNames?, format? }`.
2. The markdown pack is returned inline and also persisted as an artifact.
3. For practice, open a Ghostwriter thread for the same job and select the mock-interview preset (the prompt lives in `orchestrator/src/server/services/interview-prep.ts`).

The `interviews` legacytable is no longer used — `stage_events` with `metadata.eventType='interview_log'` is the chronological store.

## Common problems

| Problem | Fix |
|---|---|
| STAR mapping blank | Add stories in **Career preferences → STAR interview stories** (`useFor` tags like `ownership`, `conflict`). |
| Pack leans generic | Fill tailoring/prior stage notes; the pack's value is proportional to the material on file. |

## Related pages

- [/docs/features/career-preferences](/docs/features/career-preferences)
- [/docs/features/ghostwriter](/docs/features/ghostwriter)
- [/docs/features/company-research](/docs/features/company-research)

