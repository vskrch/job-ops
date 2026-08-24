---
id: deadline-lifecycle
title: Deadline lifecycle
description: Deadline extraction at discovery, urgency badges and tie-breaks, and the reversible expiry sweep for past-deadline jobs.
sidebar_position: 13
---

## What it is

A thin layer over the existing `jobs.deadline` column:

- **Extraction:** `shared/src/deadline.ts`'s helpers detect an ISO `YYYY-MM-DD` date on or near a `deadline`/`closing date` keyword line in posting text. Non-ISO shapes near the same keyword are accepted; a bare date with no keyword is *not* promoted to a deadline.
- **Urgency:** `daysUntilDeadline`, `isUrgentDeadline(≤7d)`, `isPastDeadline` drive sort tie-breaks and UI badges.
- **Expiry sweep:** `markPastDeadlineJobsExpired()` flips `discovered/ready/processing` jobs whose `deadline` is past UTC today to `expired`. Re-discovery or a manual status change reopens them — the sweep is **reversible** and never touches `applied`/`in_progress` jobs.

## Why it exists

Expired postings waste scoring and shortlisting budget. An urgency signal helps operators prioritize closing roles (mirrors the source project's 🔥 marker pattern but derived deterministically).

## How to use it

1. Importings extractors or scoring may populate `deadline`; when absent, the text helpers remain available via the deadline module.
2. In the UI, deadlines surface on the board/job page with badges: `Closes today` / `Closes in Nd` / `Expired Nd ago`.
3. The sweep runs at the start of the pipeline's scoring step (and can be invoked from any caller's `jobsRepo.markPastDeadlineJobsExpired()`).

## Common problems

| Problem | Fix |
|---|---|
| `deadline` line not detected | Verify the posting text contains the word "deadline" (or "closing date" / "expires") within 2 lines of the date; the parser is intentionally strict to avoid inferring a deadline from a posted date or `00:00` timestamp. |
| Job marked `expired` but should be active | Re-import from the source or move the job back from Expired — the sweep only flips `discovered/ready/processing`, so `applied` history never changes. |

## Related pages

- [/docs/features/pipeline-run](/docs/features/pipeline-run)
- [/docs/features/orchestrator](/docs/features/orchestrator)

