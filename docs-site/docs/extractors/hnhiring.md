---
id: hnhiring
title: HN Who's Hiring Extractor
description: Hidden startup job market discovery through the monthly Hacker News hiring thread.
sidebar_position: 23
---

## What it is

Source: [Hacker News "Who is hiring?"](https://news.ycombinator.com/) — the monthly hiring thread where startups post roles that never reach job boards.

This extractor reads the thread through the public Algolia HN API:

1. `extractors/hnhiring/src/run.ts` finds the latest "Who is hiring" thread, loads its comments via `https://hn.algolia.com/api/v1/items/<id>`, parses the `| Company | Role | Location |` table lines, and maps them into `CreateJobInput`.
2. `extractors/hnhiring/src/manifest.ts` adapts pipeline settings and registers the source.

## Why it exists

The monthly HN hiring thread is the deepest hidden job market for startups: thousands of roles posted directly by founders, many remote-friendly and open to visa sponsorship. No other board indexes it.

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Enable **HN Who's Hiring** in **Sources**.
3. Set your usual run controls:
   - `searchTerms` match against the full posting text (company, role, and location).
   - The selected country keeps postings whose location matches plus remote/worldwide postings.
   - `jobspyResultsWanted` caps results per term.
4. Start the run. The current month's thread is used automatically.

Defaults and constraints:

- No credentials required.
- Postings follow the thread's `Company | Role | Location` convention; posts that break the format may parse with missing fields.
- The application link is extracted from the posting text when present; otherwise the posting links to its HN comment.
- One thread per month — data refreshes when a new thread is published.

## Common problems

### A posting looks oddly structured

- Some posters don't follow the `|` convention. Only table-formatted lines are imported; free-text posts are skipped.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [JobSpy](/docs/next/extractors/jobspy)
