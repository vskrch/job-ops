---
id: remotive
title: Remotive Extractor
description: Remote job discovery through Remotive's public JSON API with country filtering.
sidebar_position: 21
---

## What it is

Original website: [Remotive](https://remotive.com/)

This extractor reads the public Remotive remote-jobs JSON API and maps listings into the job-ops schema. Remotive curates remote roles across engineering, design, sales, marketing, and more.

Implementation split:

1. `extractors/remotive/src/run.ts` queries `https://remotive.com/api/remote-jobs?search=<term>`, applies local term and country filters, and maps rows into `CreateJobInput`.
2. `extractors/remotive/src/manifest.ts` adapts pipeline settings, emits progress updates, and registers the source.

## Why it exists

Remotive is a hand-curated remote job board that broad aggregators miss. The public JSON API keeps the integration stable and fast — no scraping required.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Enable **Remotive (Remote)** in **Sources**.
3. Set your usual run controls:
   - `searchTerms` are matched locally against title, description, company, and tags.
   - The selected country keeps jobs located in that country plus worldwide-remote roles.
   - `jobspyResultsWanted` is reused as the per-term cap.
4. Start the run and monitor progress.

Defaults and constraints:

- No credentials required.
- The API's `search` parameter narrows the feed server-side; local filters are applied on top.
- Jobs include salary (when present), job type, skills, and publication date.

## Common problems

### Fewer results than expected

- The API returns a bounded feed per query. Try broader `searchTerms`.
- Country-restricted roles are excluded when a specific country is selected (worldwide-remote roles are kept).

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [RemoteOK](/docs/next/extractors/remoteok)
- [We Work Remotely](/docs/next/extractors/weworkremotely)
