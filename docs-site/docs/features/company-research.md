---
id: company-research
title: Company research
description: Per-company, per-user cached research that feeds the application reviewer and interview prep.
sidebar_position: 14
---

## What it is

A research cache for companies you apply to:

- **Table:** `company_research (user_id, company_key, company, fetched_at, payload JSON)`, unique on `(user_id, company_key)`. Company keys are normalized by lowercasing + stripping legal suffixes (`Inc.`, `A/S`, …) + slugifying.
- **TTL:** 30 days by default (`isFresh(fetchedAt, ttlMs)`); stale entries are not served unless the caller opts `allowStale`.
- **Payload:** `{ company, fetchedAt, sources: { website?, reviews?, linkedin?, media? }, notes?, sourceUrls? }` — each source carries its URL so re-verification can re-fetch a known URL instead of re-searching.

The cache is a **lead, never the final verification**. Any claim cited in generated text must still be verified per the trust-boundary rule; the cache only stores *where* each fact came from.

## Why it exists

The drafter–reviewer pass (`/apply`-style) and interview prep both research the same company. Coding 30-day persistence removes the repeated search/fetch work without weakening claim verification.

## How to use it

- `GET /api/company-research/:company` — cached research, 404 when missing (the response tells you whether POST-refresh is needed).
- `POST /api/company-research/:company/refresh` — force a refresh (currently writes a placeholder payload that shows the cache write path end-to-end; production callers may supply a full LLM+ crawler research payload via the service's `putCachedResearch`).
- Service helpers: `normalizeCompanyKey(name)`, `isFresh(fetchedAt)`, `getCachedResearch`, `putCachedResearch`, `getCompanyResearch({ allowStale, ttlMs })`, `refreshCompanyResearch`.
- Helpers are tenant-scoped — one user's `Novo Nordisk` cache never leaks to another, mirroring the profile-cache tenancy fix.

## Common problems

| Problem | Fix |
|---|---|
| `404` on GET | Run POST `/refresh` for that company first. |
| Stale data | Call with `?allowStale=true` for inspection, or POST refresh. |
| Two spellings map to different keys | Both resolve from the same normalized key once the legal-suffix strip handles them (e.g. `A.M.B.A.` variants); check `normalizeCompanyKey` in the browser console or the service's test suite. |

## Related pages

- [/docs/features/ghostwriter](/docs/features/ghostwriter)
- [/docs/features/career-preferences](/docs/features/career-preferences)

