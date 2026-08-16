---
id: weworkremotely
title: We Work Remotely Extractor
description: Remote job discovery through We Work Remotely's public RSS feed.
sidebar_position: 24
---

## What it is

Original website: [We Work Remotely](https://weworkremotely.com/)

This extractor reads the public We Work Remotely RSS feed (`/remote-jobs.rss`) and maps listings into the job-ops schema.

Implementation split:

1. `extractors/weworkremotely/src/run.ts` fetches and parses the RSS feed, applies local term and country filters, de-duplicates listings by URL, and maps rows into `CreateJobInput`.
2. `extractors/weworkremotely/src/manifest.ts` adapts pipeline settings and registers the source.

## Why it exists

We Work Remotely is one of the oldest remote job boards, covering design, marketing, and development roles at established remote-first companies.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Enable **We Work Remotely** in **Sources**.
3. Set your usual run controls:
   - `searchTerms` are matched locally against title, description, and category.
   - The selected country keeps worldwide-remote roles plus roles explicitly located in that country.
   - `jobspyResultsWanted` is reused as the per-term cap.
4. Start the run and monitor progress.

Defaults and constraints:

- No credentials required.
- The feed contains recent listings only; duplicates across categories are removed by URL.
- Company and role are split from the RSS `Company: Role` title convention.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Remotive](/docs/next/extractors/remotive)
- [RemoteOK](/docs/next/extractors/remoteok)
