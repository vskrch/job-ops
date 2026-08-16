---
id: jobboards
title: Job Boards (Regional) Extractor
description: Regional job board discovery for the US, Canada, and India through builtin, SimplyHired, Job Bank Canada, foundit, Shine, Dice, Monster, Instahyre, and Eluta.
sidebar_position: 11
---

## What it is

The Job Boards extractor runs regional job board searches for three target markets:

- **USA**: [Built In](https://builtin.com) (top tech hubs: NYC, SF, Austin, LA, Chicago, Boston, Seattle), [SimplyHired](https://www.simplyhired.com) (US & Canada aggregator), plus [Dice](https://www.dice.com) and [Monster](https://www.monster.com).
- **Canada**: [Job Bank Canada](https://www.jobbank.gc.ca) (official Government of Canada board), [SimplyHired](https://www.simplyhired.com), plus [Eluta](https://www.eluta.ca).
- **India**: [foundit](https://www.foundit.in) (formerly Monster India / APAC) and [Shine](https://www.shine.com) (major Indian tech portal), plus [Instahyre](https://www.instahyre.com).

Implementation lives in `extractors/jobboards/`:

1. `src/sites.ts` defines one parser per board (`JobBoardSite`), each with a search URL generator and a regex-based markdown parser that never throws.
2. `src/run.ts` runs the shared crawl engine per source/term, falls back to the Jina-rendered page when a site blocks direct fetches or renders client-side, then optionally LLM-extracts job details.
3. `manifest.ts` registers the extractor for runtime discovery so the sources appear in the orchestrator's pipeline source list.

## Why it exists

The regional boards maximize search depth for USA, Canada, and India job markets. They cover listings that broad aggregators (Indeed, LinkedIn) miss, including official government postings (Job Bank) and India/APAC boards (foundit, Shine).

## How to use it

1. Open **Run jobs** and choose **Automatic**.
2. Select one or more of these sources in **Sources**: `dice`, `monster`, `instahyre`, `eluta`, `builtin`, `simplyhired`, `jobbank`, `foundit`, `shine`.
3. Set your country filter to the matching market (USA, Canada, or India). Sources are filtered by country automatically.
4. Set your usual automatic run controls (search terms, budget via `jobspyResultsWanted`) and start the run.

Defaults and constraints:

- No credentials required for any of the boards.
- Each source/term is fetched via a 3-backend escalation chain: `direct` HTTP (fingerprinted) → `crawl4ai` (self-hosted headless browser, when `CRAWL4AI_BASE_URL` is set) → `jina` (Jina Reader proxy). A 200-OK CAPTCHA/block page is detected heuristically and skipped to the next backend.
- Structured data wins: when a board embeds schema.org `JobPosting` JSON-LD, fields (title, employer, location, salary, description) come from that with zero regex or LLM cost; regex and LLM parsing are fallbacks.
- The crawl engine caches responses per run, honors `Retry-After`, times out and size-caps bodies, and drops an invalid `JINA_API_KEY` automatically when configured.
- Anti-detection is layered: ~20 rotating browser fingerprints (UA + `sec-ch-ua` + platform), organic headers (`sec-fetch-*`, Google referer on first visit, same-origin on subsequent, occasional `DNT`), behavioral pacing profiles (`fast` / `normal` / `cautious` / `stealth`) with human-like inter-request spacing and occasional long pauses, and heuristic block/CAPTCHA detection (no LLM cost at the transport layer).
- Crawl4AI is optional: run `docker compose up crawl4ai` and set `CRAWL4AI_BASE_URL=http://crawl4ai:11235`. Without it the chain degrades to `direct` → `jina`. The browser backend provides stealth JS rendering for SPA boards (Monster, Instahyre).
- When an LLM is configured the run defaults to the `normal` behavioral profile; without an LLM it uses `fast`. Pass `behaviorProfile` explicitly to override.
- If an LLM is configured, list results are re-extracted with structured parsing and job detail pages are opened for descriptions, capped by the detail-page limit.
- Search results are de-duplicated by `sourceJobId` or `jobUrl`.
- Monster currently returns a page shell, so it usually yields zero jobs; it is kept so results are picked up automatically if Monster ever serves them.

## Common problems

### A regional source does not appear in Sources

- Check that the app is running a build that includes the jobboards manifest.
- Sources are filtered by the selected country: Built In/Dice/Site results require USA, Job Bank/Eluta require Canada, foundit/Shine/Instahyre require India.

### A board returns no jobs

- Some boards (Monster) render fully client-side and need the Jina fallback; confirm the fetch falls back correctly by checking pipeline logs for the source.
- Job Bank Canada and foundit mark every result with a fixed country label; titles and URLs remain the authoritative fields.

### Duplicate or low-quality listings

- Parsers emit only the fields the rendered page exposes (title, employer, location where available). If your LLM is configured, the structured extraction pass fills in descriptions and refines the records.

## Related pages

- [Extractors Overview](/docs/next/extractors/overview)
- [Pipeline Run](/docs/next/features/pipeline-run)
- [Add an Extractor](/docs/next/workflows/add-an-extractor)
