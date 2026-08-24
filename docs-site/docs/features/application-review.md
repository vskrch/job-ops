---
id: application-review
title: Application reviewer
description: The drafter–reviewer second pass with grounding audit and structured edits, applied mechanically to tailored drafts.
sidebar_position: 17
---

## What it is

- **Service:** `orchestrator/src/server/services/application-review.ts`
- **Contract:** `reviewTailoredDraft({ job, draft: { headline, summary, skillsJson }, profile? }) → { edits: {file, oldString, newString, reason}[], narrative: {missedKeywords, companyAngles, reframing, tone}, groundingFlags }`.
- **Grounding audit:** every date/title/metric in the tailored draft must trace to the 3-source union (profile JSON + master CV). Flags carry `reason: "grounding"`.
- **Structured edits (Part A):** `applyStructuredEdits(draft, edits)` applies only exact-string replacements; mismatched `oldString` entries are skipped and surfaced.
- **Narrative (Part B):** grouped per category, presented even when empty.

On LLM failure (no API key), the service returns an empty edit set with a narrative that advises manual review — the feature never blocks the pipeline.

## Why it exists

A second fresh-context pass catches keyword drift and hallucinations with minimal extra spend, mirroring the source drafter–reviewer pattern.

## How to use it

Import `reviewTailoredDraft` from application review and call it after tailoring, before PDF rendering:

```ts
import { reviewTailoredDraft, applyStructuredEdits } from "@server/services/application-review";

const { edits } = await reviewTailoredDraft({ job, draft: { headline, summary, skillsJson } });
const { draft: revised, skipped } = applyStructuredEdits(draft, edits);
// Persist `revised` and any `skipped` warnings.
```

## Common problems

| Problem | Fix |
|---|---|
| All edits reported `skipped` | The draft text changed after the review was issued — re-draft-then-review atomically. |
| No narrative returned | The LLM call failed — check the Tailoring model/Secret in Settings → Models. |

## Related pages

- [/docs/features/ghostwriter](/docs/features/ghostwriter)
- [/docs/features/company-research](/docs/features/company-research)
- [/docs/features/career-preferences](/docs/features/career-preferences)

