---
id: multi-tenancy
title: Multi-Tenancy & User Isolation
description: Architecture and behavior for per-user data isolation across schedules, pipelines, profiles, and integrations.
sidebar_position: 16
---

## What it is

JobOps enforces strict per-user multi-tenancy across all platform resources. Every schedule, pipeline run, job discovery feed, tailored profile, resume document, email integration, and configuration is isolated to the authenticated user.

Key isolated entities:
- **Pipeline Schedules**: Recurring multi-source scraping jobs configured per user.
- **Search Schedules**: Recurring natural language searches running on scheduled intervals.
- **Pipeline Runs & Ingestion**: Discovered jobs and auto-imported applications belong strictly to the triggering user.
- **Saved Jobs & Statuses**: Discovered, ready, applied, and in-progress job boards are private to each user.
- **Profiles & Tailored Resumes**: User preferences, skill bullet points, and LaTeX / RxResume documents.
- **Post-Application Integrations**: User-connected email accounts (Gmail, IMAP), sync runs, and recruiter messages.

## Why it exists

In multi-user deployments (such as shared family servers, team instances, or hosted deployments), users require complete isolation:
- No user should see, edit, or delete another user's scheduled pipelines or searches.
- Automated background tasks (cron schedulers) must execute within the owning user's context so discovered jobs and auto-tailored resumes deposit directly into the correct account.
- Integration credentials and email sync feeds must remain private.

## How to use it

Multi-tenancy operates automatically based on your authenticated session:

1. **User Authentication**:
   - Log in or register an account.
   - The server associates your session with your unique `userId` and propagates it via request context (`AsyncLocalStorage`).
2. **Creating Schedules**:
   - Navigate to **Orchestrator** or **Job Search**.
   - Create a pipeline or search schedule.
   - The schedule is automatically tagged with your `userId` and visible only on your dashboard.
3. **Background Execution**:
   - When the scheduler fires at the configured hour or interval, it runs within your user context.
   - All jobs discovered by background searches and pipeline executions are saved to your account.
4. **Profile & Resume Tailoring**:
   - Update your profile and design resume in **Settings** or **Design Resume**.
   - These tailored assets are strictly used when scoring and tailoring jobs for your account.

## Common problems

### Schedules not appearing after switching accounts

- Verify you are logged into the account that originally created the schedule.
- Each schedule is strictly filtered by the authenticated user's ID.

### Background pipeline run saved jobs to another account

- Background scheduler runs are bound to the `userId` stored in the schedule record at creation time.
- If a schedule was migrated from a single-user legacy install, it defaults to `default-user`. Re-saving the schedule under your logged-in account updates ownership.

## Related pages

- [Pipeline Runs](/docs/features/pipeline-run)
- [Design Resume](/docs/features/design-resume)
- [Post-Application Tracking](/docs/features/post-application-tracking)
- [Settings](/docs/features/settings)
