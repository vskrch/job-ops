---
id: followups
title: Follow-ups
description: Quiet-application detection, draft-only follow-ups with max-2 cap, and the In Progress Board panel.
sidebar_position: 15
---

## What it is

A thin follow-up assistant for open applications:

- **Quiet detection:** `daysSince(latestStageEvent)` vs a configurable threshold (default 10 days). An `applied`/`in_progress` job is "quiet" when its latest dated stage event is older than the threshold and fewer than 2 follow-ups have been logged for it.
- **Drafts-only:** `POST /api/followups/draft` generates a channel-shaped note (email/LinkedIn/portal) from the job's tailored artifacts only — **no new claims** are introduced. The note is 60–120 words, persisted as an `application_artifacts` row of kind `followup`, and shown in the UI for editing before you send.
- **Log:** `POST /api/followups/log` writes a `stage_events` row with `metadata.kind='followup'` (append-only), incrementing the per-job counter that gates the max-2 rule.
- **Board panel:** `QuietFollowupsPanel` mounts on the In Progress board, listing each quiet job with days-quiet/follow-up count, a Draft/Copy/Log flow per row, and a thank-you note shortcut (`POST /api/followups/thank-you/draft`).

## Why it exists

Expired applications and ghosted pipelines cost operator attention. A consistent, drafts-never-sent follow-up cadence (the source project's documented 10d / max-2 rule) systematizes nudges without automating sends.

## How to use it

1. Open the **In Progress Board** — when any job is ≥10 days quiet and under the 2-follow-up cap, the amber panel appears at the top of the page.
2. Click **Draft** for a job — the generated note appears in a textarea (edit freely).
3. **Copy** to clipboard and send via your channel.
4. Click **Log as sent** after you send — the board updates and the history is append-only.

Programmatic use: `GET /api/followups/quiet`, `POST /api/followups/draft`, `POST /api/followups/log`, `POST /api/followups/thank-you/draft`. All via `{ ok, data, meta.requestId }`.

## Common problems

| Problem | Fix |
|---|---|
| Quiet panel not appearing | No open `applied`/`in_progress` job is past the 10-day threshold, or each quiet job already has 2 logged follow-ups — the cap is enforced in `followUpCountForJob`. |
| "Never sent" job flagged quiet | A `ready` (tailored-only) job is never quiet — the detector filters to `applied`/`in_progress`. |

## Related pages

- [/docs/features/in-progress-board](/docs/features/in-progress-board)
- [/docs/features/post-application-tracking](/docs/features/post-application-tracking)

