---
id: career-preferences
title: Career preferences
description: Language proficiency, deal-breakers, career goals, behavioral notes, and the STAR story bank that feeds scoring and interview prep.
sidebar_position: 11
---

## What it is

The **Career preferences** section on Settings → My Resume is the structured supplement to your uploaded resume. It stores:

- **Languages you work in** with free-text proficiency levels (native, fluent, B2…). The scoring *Language Gate* reads this — a posting requiring an undeclared language is excluded; a posting asking for a higher level than you declared is flagged for your judgment.
- **Deal-breakers** — hard veto conditions (e.g. "requires security clearance", "no on-call"). A posting whose requirements match one is forced to `skip` regardless of score.
- **Career goals** and **behavioral notes** (what energizes/drains you) — inputs to the career and behavioral scoring dimensions.
- **STAR story bank** — Situation/Task/Action/Result examples tagged with question types (`useFor`), mapped by interview prep onto likely questions.

## Why it exists

A resume alone is underspecified for ranking. Proficiency levels, vetoes, and STAR stories need curating once, not parsing from a PDF each time. Storing them explicitly also keeps them **append-only** to resume re-uploads (a new PDF upload never wipes preferences).

## How to use it

1. **Upload a resume** (My Resume) — preferences are stored on that profile.
2. Scroll to **Career preferences**. Each field loads from `GET /api/user-profile` and saves via `PATCH /api/user-profile/preferences`.
3. Edit:
   - **Languages:** Add rows of name + level (suggestions include native, fluent, professional, conversational, basic, plus CEFR letters). Leave level empty to clear it.
   - **Deal-breakers / Career goals:** One per line.
   - **Behavioral notes:** Free-text paragraph.
   - **STAR stories:** Click *Add story*, fill title/useFor/situation/task/action/result, Save.
4. Click **Save preferences** — the profile cache is invalidated, so the next pipeline run sees the new data immediately.

`languages` (the resume's plain list) stays the renderer-facing field; `languageLevels` is the evaluation-facing structure — both are kept.

## Common problems

| Problem | Fix |
|---|---|
| `PATCH /preferences` returns 404 | Upload a resume first — preferences are stored on the profile and survive re-uploads, not without one. |
| Language gate keeps vetoing a role you could do | Add the language to the table, or lower the posting's stated bar by editing `languageLevels` for that language — an absent language is a FAIL by design. |
| STAR tags don't appear in prep packs | Make sure `useFor` tags match question types (e.g. `conflict`, `ownership`, `failure`) — the mapper prefers tag overlap. |

## Related pages

- [/docs/features/pipeline-run](/docs/features/pipeline-run) — scoring dimensions and gates that read these fields.
- [/docs/features/post-application-tracking](/docs/features/post-application-tracking) — interview prep consumes STAR stories.

