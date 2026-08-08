---
id: usajobs
title: USAJOBS Extractor
description: US federal government job discovery through the official USAJOBS API.
sidebar_position: 25
---

## What it is

Original website: [USAJOBS](https://www.usajobs.gov/)

This extractor queries the official USAJOBS search API and maps federal job postings into the job-ops schema. Federal roles are a classic hidden job market — most never appear on commercial boards.

Implementation split:

1. `extractors/usajobs/src/run.ts` queries `https://data.usajobs.gov/api/search` per search term, filters results locally, and maps them into `CreateJobInput`.
2. `extractors/usajobs/src/manifest.ts` adapts pipeline settings and registers the source.

## Why it exists

USAJOBS is the only official US federal job board: government agencies, national labs, and public-sector roles with structured salary bands and application deadlines. The official API is stable and returns rich structured data.

## How to use it

1. Register for a free API key at `https://developer.usajobs.gov/` and set it:
   - Self-hosting: add `USAJOBS_API_KEY` to your environment (`.env` or container env).
2. Open **Run jobs** and choose **Automatic**.
3. Enable **USAJOBS (Federal)** in **Sources**.
4. Set your usual run controls (`searchTerms` become the API keyword; `jobspyResultsWanted` caps results per term).

Defaults and constraints:

- **Requires `USAJOBS_API_KEY`.** Without it the extractor reports success with zero jobs and a notice.
- The API is US-only by design; country filtering does not apply.
- Postings include salary range, grade level, application deadline, remote/onsite offering, and the apply link.

## Common problems

### No jobs collected

- Confirm `USAJOBS_API_KEY` is set and the extractor's progress shows no error.
- The API rejects unregistered keys with `401 Unauthorized`.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Job Boards](/docs/next/extractors/jobboards)
