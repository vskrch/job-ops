# ADR-003: Crawl Engine Hardening — Resilience, Anti-Detection, and Extractor Consolidation

**Status:** Accepted (pending implementation)
**Date:** 2026-08-12
**Decision Type:** Architecture / Crawl Infrastructure
**Scope:** `shared/src/crawl/`, `extractors/*`, `orchestrator/src/server/services/job-search/`, `orchestrator/src/server/services/agentic/`
**Target:** Crawl Engine v2

---

## 1. Context

The crawl engine (`shared/src/crawl/engine.ts`) implements a 3-backend escalation chain (`direct → crawl4ai → jina`) with fingerprint rotation, organic headers, heuristic block detection, and behavioral pacing. This architecture is sound and was validated in `adr/crawler.md` (CLOSED).

However, a full audit of the crawl path — engine, extractors, job-search orchestrator, and agentic search — revealed **25 concrete gaps** that cause sources to fail silently, waste crawl cycles, or break when sites change. This ADR documents the re-audited findings (each verified against the current code) and proposes a phased hardening plan.

**Constraint:** The existing system must remain reliable. No change may break the lights-on contract (extractors degrade gracefully, never throw). All hardening must be backward-compatible and testable with the existing CI-parity checks.

---

## 2. Re-Audited Findings (verified against code, 2026-08-12)

### 2.1 Critical — Actively causing failures

| # | Finding | Evidence | Impact |
|---|---------|----------|--------|
| C1 | **Circuit breaker is dead code** — `AdaptiveCircuitBreaker` (engine.ts:736) and `AdaptiveCooldown` (engine.ts:789) are fully implemented but never instantiated in the request path. Grep confirms zero usages outside engine.ts. | `grep -rn "AdaptiveCooldown" shared/src/` → only engine.ts | A site that starts blocking is hammered repeatedly with no cooldown, worsening bans |
| C2 | **11 of 18 extractors bypass CrawlEngine** — `talent`, `aijobs`, `hasjob`, `careerbuilder`, `workopolis`, `remoteok`, `himalayas`, `remotive`, `weworkremotely`, `hnhiring`, `usajobs` use raw `fetchImpl` (defaulting to global `fetch`) with no retry, no block detection, no backend fallback, no pacing. Only `jobboards` uses the engine. | `grep -rn "CrawlEngine" extractors/` → only `extractors/jobboards/src/run.ts` | These extractors have zero anti-detection and zero resilience; they will fail on any block or transient error |
| C3 | **No fetch timeout on raw-fetch extractors** — none of the 11 raw-fetch extractors pass an `AbortSignal` to `fetchImpl`. Verified: `talent/src/run.ts:134` calls `fetchImpl(url, { headers })` with no signal. | `grep -c "AbortSignal" extractors/{talent,aijobs,...}/src/run.ts` → 0 | A hanging server stalls the extractor indefinitely; the orchestrator's cooperative timeout only works if the extractor checks `shouldCancel()`, which it can't during a pending fetch |
| C4 | **No subprocess timeout** — `jobspy`, `adzuna`, `hiringcafe`, `gradcracker`, `ukvisajobs` spawn child processes with no timeout. Verified: `jobspy/src/run.ts:233` spawns Python with no timeout; `adzuna/src/run.ts:225` spawns npm with no timeout. | `grep -n "timeout" extractors/{jobspy,adzuna,hiringcafe,gradcracker,ukvisajobs}/src/run.ts` → only ukvisajobs has one (10s on description fetch) | A hung subprocess hangs the extractor permanently |
| C5 | **`sites.ts` regex parsers are extremely brittle** — 23 site parsers all assume specific Jina markdown output formats (e.g. `dice` expects `https://www.dice.com/job-detail/[a-f0-9-]+`). Any change in Jina's rendering or a site's URL structure produces zero jobs silently. | `extractors/jobboards/src/sites.ts` (727 lines) | Silent data loss; no alerting when parse rates drop to zero |
| C6 | **`instahyre` parser has data corruption risk** — merges two regex passes by index (sites.ts:138-144). If URL regex and text regex match different counts, employer/location attribution is silently misaligned. | `extractors/jobboards/src/sites.ts:105-146` | Wrong employer/location on jobs — data corruption, not just failure |
| C7 | **`monster` is known broken** — code comment: "Jina currently returns the page shell, so this usually yields zero jobs. Kept so the backend-order trick picks results up automatically if Monster ever serves them." | `extractors/jobboards/src/sites.ts:148-152` | Wastes a crawl cycle every run; no alerting |

### 2.2 High — Will break soon

| # | Finding | Evidence | Impact |
|---|---------|----------|--------|
| H1 | **Fingerprints are 2 years old** — Chrome 124-126, Firefox 125-127, Safari 17.4 (mid-2024). In Aug 2026, current Chrome is ~140+. macOS `10_15_7` (Catalina, 2019) in UA strings is a strong detection signal. | `shared/src/crawl/fingerprints.ts:33-73` | Anti-bot systems flag outdated UAs; direct backend increasingly blocked |
| H2 | **20 fingerprints, sequential rotation, no mobile** — deterministic round-robin (`rotateIndex % fingerprints.length`), zero mobile fingerprints (~60% of real traffic), only `en-US`/`en-GB` locales. The rotation pattern itself is a fingerprint. | `shared/src/crawl/fingerprints.ts` (215 lines) | Detection risk; rotation pattern is predictable |
| H3 | **Block detector missing modern anti-bot systems** — no Akamai (`_abck`, `bm_sz`), Imperva/Incapsula (`incap_ses`, `visid_incap`, `reese84`), Kasada (`kdjIO`), Shape Security, AWS WAF (`awswaf`), or Cloudflare Turnstile (`cf-turnstile`) patterns. Only checks first 4000 chars of body. No header-based detection. | `shared/src/crawl/block-detector.ts` (86 lines) | Modern anti-bot pages pass through undetected |
| H4 | **Block detector false positives** — `"cloudflare"` and `"attention required"` are too broad. A legitimate page mentioning Cloudflare in its footer or "attention to detail required" in a job posting is classified as blocked. | `shared/src/crawl/block-detector.ts:16-37` | Legitimate pages escalated to browser backends unnecessarily |
| H5 | **Crawl4AI block detection skipped for markdown** — Crawl4AI returns `text/markdown` by default, but block detection only runs for `text/html` (engine.ts:555, 688). CAPTCHAs rendered into markdown pass through undetected. | `shared/src/crawl/engine.ts:555,688` | Blocked pages treated as successful crawls |
| H6 | **LLM results replace regex results entirely** — `jobboards/src/run.ts:253`: `if (llmJobs && llmJobs.length > 0) parsed = llmJobs`. If LLM returns 2 jobs and regex found 50, you get 2 jobs. No merge strategy. | `extractors/jobboards/src/run.ts:245-253` | Data loss when LLM underperforms |
| H7 | **Cache has no TTL** — in-memory LRU cache (256 entries, engine.ts:217) stores responses forever for the process lifetime. No TTL, no invalidation. | `shared/src/crawl/engine.ts:217,300-310` | Long-running processes serve increasingly stale data |
| H8 | **Jina URL double-encoding** — `encodeURIComponent(options.url)` (engine.ts:406) double-encodes already-encoded URLs, potentially fetching the wrong page. | `shared/src/crawl/engine.ts:406` | Wrong page fetched via Jina fallback |

### 2.3 Resilience gaps

| # | Finding | Evidence | Impact |
|---|---------|----------|--------|
| R1 | **No source-level retry** — when a source fails (transient Crawl4AI downtime, network blip), it's marked failed and the run continues. No re-queue, no retry with backoff at the orchestrator level. | `orchestrator/src/server/services/job-search/source-runner.ts` | Transient failures permanently lose a source for that run |
| R2 | **Crawl4AI has no retry** — a single transient Crawl4AI failure immediately escalates to Jina (engine.ts:400-402, 674). | `shared/src/crawl/engine.ts:400-402` | Jina proxy overwhelmed with traffic that should be handled by the browser backend |
| R3 | **No timeout on LLM calls** — `chatJson` in `job-parser.ts` is called without an `AbortSignal` (lines 133, 185). A hanging LLM provider hangs the extractor. | `shared/src/llm/job-parser.ts:133,185` | Extractor hangs on LLM provider outage |
| R4 | **Organic headers module-level state** — `visitedDomains` Set (organic-headers.ts:18) is shared across all engine instances, grows unbounded, never resets in production. | `shared/src/crawl/organic-headers.ts:18` | Cross-instance referer contamination; unbounded memory |
| R5 | **Retry-After HTTP-date format ignored** — only integer seconds parsed (engine.ts:843); RFC 7231 HTTP-date format silently dropped. | `shared/src/crawl/engine.ts:843` | Site's cooldown guidance lost |
| R6 | **Agentic loop re-runs all sources every iteration** — successful sources are re-crawled on each iteration (agentic/orchestrator.ts:429-438), wasting resources and hitting rate limits. | `orchestrator/src/server/services/agentic/orchestrator.ts:429-438` | Rate-limit risk; wasted crawl budget |
| R7 | **Resource group waiter queue is unbounded** — no fail-fast for group semaphore waiters (scheduler.ts:78-108). 100 tasks wanting the "browser" group (max 1) wait forever with no timeout. | `orchestrator/src/server/services/job-search/scheduler.ts:78-108` | Deadlock risk under load |
| R8 | **Crawl4AI `networkidle` is too slow** — waits for 500ms of zero network activity (crawl4ai-backend.ts:136). Modern SPAs with analytics/beacons may never reach idle. | `shared/src/crawl/crawl4ai-backend.ts:136` | Timeouts on JS-heavy pages |
| R9 | **Description fetch uses no Crawl4AI** — `fetchDescriptions` uses `["direct", "jina"]` (jobboards/src/run.ts:125), inconsistent with list page which uses the full 3-backend chain. | `extractors/jobboards/src/run.ts:125` | Detail pages blocked by anti-bot never get descriptions |
| R10 | **SPA retry may hit cache** — the second fetch attempt (jobboards/src/run.ts:228-234) doesn't pass `cache: false`. Cache key is per-backend (engine.ts:300-310), so if the first request escalated to crawl4ai and cached an empty shell, the retry serves the same empty result. | `extractors/jobboards/src/run.ts:228-234` | SPA boards never recover from cached empty shells |

---

## 3. Decision

Adopt a **phased hardening plan** across four workstreams. Each phase is independently shippable and testable.

### Phase 1 — Engine Core Hardening (highest ROI)

1. **Wire the circuit breaker into the request path.** Instantiate `AdaptiveCooldown` per `CrawlEngine` instance; check cooldown before each request; record failures (429/block/5xx) and successes; trip after N consecutive failures; half-open probe after cooldown. This is the single highest-impact fix — the code already exists, it just needs wiring.

2. **Add retry to Crawl4AI backend.** Give `crawl4ai` the same retry-with-backoff treatment as direct/jina (2 attempts, exponential backoff with jitter) before escalating to Jina.

3. **Fix block detection gaps:**
   - Add modern anti-bot patterns: Akamai (`_abck`, `bm_sz`, `akamai`), Imperva (`incap_ses`, `visid_incap`, `reese84`), Kasada (`kdjIO`, `kpjs`), AWS WAF (`awswaf`), Cloudflare Turnstile (`cf-turnstile`, `challenges.cloudflare.com`).
   - Add header-based detection: `Server: cloudflare`, `CF-RAY`, `X-Akamai-Transformed`, `X-Iinfo` (Imperva).
   - Narrow false positives: require `cloudflare` to appear with challenge context (`cf-challenge`, `cf-mitigated`, `just a moment`, `checking your browser`) rather than alone; remove bare `attention required`.
   - Run block detection on Crawl4AI markdown output too (check `fitMarkdown`/`markdown` for challenge strings).

4. **Add cache TTL.** Default 5 minutes (configurable via `cacheTtlMs` option). Stale entries evicted on read.

5. **Fix Jina URL encoding.** Use `encodeURI` (preserves existing `%XX` sequences) instead of `encodeURIComponent` for the Jina proxy URL.

6. **Fix Retry-After parsing.** Parse both integer seconds and RFC 7231 HTTP-date format.

7. **Fix organic headers state.** Move `visitedDomains` into the `CrawlEngine` instance (per-instance state) with a bounded size (e.g. 1000 domains, LRU eviction).

### Phase 2 — Fingerprint Modernization

1. **Update fingerprints to 2026 versions.** Chrome 138-142, Firefox 138-142, Safari 18.x, Edge 138-142. Update `sec-ch-ua` GREASE brand format to current (`"Not)A;Brand"`).

2. **Add mobile fingerprints.** 8-10 mobile fingerprints (Chrome Android, Safari iOS) with matching `sec-ch-ua-mobile: ?1` and mobile UA strings.

3. **Add locale diversity.** Mix `en-US`, `en-GB`, `en-CA`, `en-IN`, `de-DE`, `fr-FR` accept-language headers.

4. **Randomize rotation.** Replace sequential round-robin with random selection (weighted toward less-recently-used) to avoid a predictable rotation pattern.

5. **Add a fingerprint freshness mechanism.** Document a quarterly refresh cadence; optionally add a `FINGERPRINT_SOURCE_URL` env var for future auto-update.

### Phase 3 — Extractor Consolidation

1. **Canary Rollout for Raw-Fetch Extractors.** To mitigate big-bang integration risk with the new circuit breaker, canary the migration by moving a single low-risk extractor (e.g., `remoteok`) to `CrawlEngine.request()` first. Let it run for 48 hours to validate circuit breaker telemetry.

2. **Migrate Remaining raw-fetch extractors to CrawlEngine.** After canary validation, migrate `talent`, `aijobs`, `hasjob`, `careerbuilder`, `workopolis`, `himalayas`, `remotive`, `weworkremotely`, `hnhiring`, `usajobs` — replace `fetchImpl` with `CrawlEngine.request()` using the full backend chain. This gives them retry, block detection, pacing, and backend fallback for free.

3. **Add fetch timeouts everywhere.** Every `fetchImpl` call gets `AbortSignal.timeout(25_000)` (or the engine's default timeout when migrated).

4. **Add subprocess timeouts.** `jobspy`, `adzuna`, `hiringcafe`, `gradcracker`, `ukvisajobs` — wrap `spawn` with a timeout (default 120s, configurable) that kills the child and rejects.

5. **Fix `sites.ts` brittleness:**
   - Add a **parse-rate monitor**: track jobs-per-page per site; if a site returns zero jobs for N consecutive runs, log a warning and mark the source degraded (visible in extractor-health).
   - Fix `instahyre` index-merge corruption: parse URLs and text in a single pass or verify counts before merging.
   - Remove `monster` from the active list (or gate it behind an env flag) until it actually works.
   - Add JSON-LD-first parsing for all sites (already exists in `run.ts` — extend to detail pages).

6. **Fix LLM replace-not-merge.** When LLM returns jobs, merge with regex results (dedupe by URL) instead of replacing. LLM fills gaps; regex provides the baseline.

7. **Fix SPA retry cache.** Pass `cache: false` on the SPA retry request.

8. **Fix description fetch backend chain.** Use `["direct", "crawl4ai", "jina"]` for detail pages when Crawl4AI is configured.

### Phase 4 — Orchestrator Resilience

1. **Source-level retry.** In `source-runner.ts`, retry failed manifests once with backoff (e.g. 5s) before marking failed. Configurable via `JOB_SEARCH_SOURCE_RETRY` env var.

2. **Agentic loop: re-run only failed sources.** Track per-iteration source success; on subsequent iterations, only re-run sources that failed or returned zero jobs.

3. **Resource group waiter timeout.** Add a max wait (default 60s) to `acquireGroupSlot`; on timeout, fail the task with a structured error instead of waiting forever.

4. **LLM call timeouts.** Pass `AbortSignal.timeout(90_000)` to `chatJson` calls in `job-parser.ts` (matching the orchestrator's LLM service timeout).

---

## 4. Non-Goals

- **No new crawling framework.** Crawl4AI remains the browser backend. Firecrawl (AGPL, heavy stack), Browser Use (agent-level, LLM cost per page), and Scrapy (Python, no LLM integration) were evaluated in `adr/crawler.md` and rejected. This ADR hardens what exists.
- **No proxy pool in this phase.** IP rotation is a separate concern (cost, compliance); fingerprint + pacing + circuit-breaker hardening addresses the immediate failure modes.
- **No distributed crawling.** Single-process architecture remains; Redis/BullMQ workers are deferred.
- **No changes to the lights-on contract.** All extractors must continue to degrade gracefully.

---

## 5. Verification Plan

### Automated tests (per phase)

```bash
# Phase 1: engine core
npm --workspace orchestrator run test:run   # engine.test.ts, block-detector.test.ts, crawl4ai-backend.test.ts

# Phase 2: fingerprints
npm --workspace orchestrator run test:run   # fingerprints.test.ts

# Phase 3: extractors
npm --workspace orchestrator run test:run   # sites.test.ts, run.test.ts per extractor

# Phase 4: orchestrator
npm --workspace orchestrator run test:run   # source-runner.test.ts, scheduler.test.ts
```

### CI-parity checks (all phases)

```bash
./orchestrator/node_modules/.bin/biome ci .
npm run check:types:shared
npm --workspace orchestrator run check:types
npm --workspace orchestrator run build:client
npm --workspace orchestrator run test:run
```

### Manual verification

- Run `docker compose up crawl4ai` and verify the 3-backend chain escalates correctly (direct blocked → crawl4ai → jina).
- Trigger a jobboards crawl for a known SPA board (Monster/Instahyre) and verify the SPA retry bypasses cache.
- Stop the Crawl4AI container mid-run and verify the engine escalates to Jina without hanging.
- Verify circuit breaker trips after N consecutive blocks and half-opens after cooldown.

---

## 6. Risks and Mitigations

| Risk | Mitigation |
|------|-----------|
| Fingerprint updates break existing tests | Update test fixtures in the same commit; fingerprints are data, not logic |
| Circuit breaker false trips on legitimate traffic | Conservative thresholds (N=5 consecutive failures); half-open probe after cooldown; per-source breakers only |
| Extractor migration to CrawlEngine changes behavior | Keep `fetchImpl` injection for tests; run extractor tests before/after migration; lights-on contract preserved |
| Block detector false positives worsen | Narrow patterns (context-aware matching); add allowlist for known-good domains |
| Cache TTL reduces freshness | Default 5 min TTL is configurable; `cache: false` available for critical paths |

---

## 7. Decision — ACCEPTED

The 25 findings are verified against the current codebase. The phased hardening plan is approved for implementation. Each phase is independently shippable; Phase 1 (engine core) is the highest priority and should be implemented first.

**Status:** Accepted (pending implementation)
**Date:** 2026-08-12
