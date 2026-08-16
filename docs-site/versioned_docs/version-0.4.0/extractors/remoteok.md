---
id: remoteok
title: RemoteOK Extractor
description: Remote startup job discovery through RemoteOK's public JSON feed.
sidebar_position: 22
---

## What it is

Original website: [RemoteOK](https://remoteok.com/)

This extractor reads the public RemoteOK JSON feed and maps listings into the job-ops schema. RemoteOK is a curated board of remote startup roles with salary ranges.

Implementation split:

1. `extractors/remoteok/src/run.ts` fetches `https://remoteok.com/api`, applies local term and country filters, and maps rows into `CreateJobInput`.
2. `extractors/remoteok/src/manifest.ts` adapts pipeline settings, emits progress updates, and registers the source.

## Why it exists

RemoteOK lists startup remote jobs that rarely appear on general boards, with salary bands included. The public feed keeps the integration lightweight.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Enable **RemoteOK** in **Sources**.
3. Set your usual run controls:
   - `searchTerms` are matched locally against position, description, company, and tags.
   - Country filtering uses the location field and flag emojis (`🇺🇸`, `🇨🇦`, `🇮🇳`); worldwide-remote roles are kept for any selected country.
   - `jobspyResultsWanted` is reused as the per-term cap.
4. Start the run and monitor progress.

Defaults and constraints:

- No credentials required.
- The feed contains the latest ~100 listings; per-term results vary with how many listings match.
- Salaries map into the structured salary fields (`salaryMinAmount`, `salaryMaxAmount`, `salaryCurrency`).

## Common problems

### Fewer results than expected

- The feed is a rolling snapshot of recent listings, not a full index. Run frequently or use broader terms.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Remotive](/docs/next/extractors/remotive)
- [We Work Remotely](/docs/next/extractors/weworkremotely)
