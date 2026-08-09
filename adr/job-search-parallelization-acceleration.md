# ADR-002: Parallel and Accelerated Job Search Execution

**Status:** Proposed  
**Date:** 2026-08-09  
**Decision Type:** Architecture / Performance / Reliability  
**Scope:** Existing natural-language job-search and aggregation flow

Related ADRs:

* [Agentic Search Implementation Plan](./agentic-implementation-plan.md)
* [Agentic Search Integration V2](./agentic-integration-v2.md)
* [Crawler Architecture](./crawler.md)

---

## 1. Context

The existing job-search path is:

```text
query -> LLM parsing -> extractor discovery -> aggregation
      -> deduplication -> strict filtering -> LLM ranking
      -> report persistence -> optional email
```

Relevant implementation locations:

| Concern | Location |
|---|---|
| HTTP API | `orchestrator/src/server/api/routes/job-search.ts` |
| Search execution | `orchestrator/src/server/services/job-search/orchestrator.ts` |
| Extractor registry | `orchestrator/src/server/extractors/registry.ts` |
| Extractor contract | `shared/src/types/extractors.ts` |
| Pipeline source planning reference | `orchestrator/src/server/pipeline/steps/discover-jobs.ts` |
| Async scheduling | `orchestrator/src/server/utils/async-pool.ts` |
| Deduplication | `orchestrator/src/server/services/job-search/dedup.ts` |
| Filtering | `orchestrator/src/server/services/job-search/filter.ts` |
| Ranking | `orchestrator/src/server/services/job-search/ranking.ts` |
| Progress/SSE | `orchestrator/src/server/services/job-search/progress.ts` |
| Persistence | `orchestrator/src/server/repositories/job-search.ts` and `orchestrator/src/server/db/schema.ts` |
| Client UI | `orchestrator/src/client/pages/JobSearchPage.tsx` |

The system already uses bounded concurrency, but it has four major limitations:

* Query parsing blocks the POST response.
* Source work is scheduled by source ID even when one manifest owns multiple sources.
* Deduplication, filtering, and ranking wait for every source to finish.
* Ranking creates unnecessary per-job LLM setup and has no shared provider limiter.

The application uses Express, in-process background work, SQLite with
`better-sqlite3`, dynamically loaded extractor manifests, and an existing
provider-agnostic `LlmService`. There is no distributed worker queue.

The objective is to reduce acknowledgement latency, time to first useful
result, and total search duration without changing hard-filter semantics,
corrupting shared extractor output, overloading upstream providers, or making
email a prerequisite for UI results.

---

## 2. Goals

* Return a search acknowledgement without waiting for query parsing.
* Invoke each multi-source manifest once per search.
* Run independent extractor work concurrently within resource limits.
* Continue when individual providers fail.
* Enforce explicit constraints before any LLM ranking.
* Show provisional results while slow sources are still running.
* Produce deterministic final results regardless of source completion order.
* Reduce ranking setup overhead and coordinate LLM request limits.
* Keep email delivery optional and isolated from search completion.
* Add metrics, feature flags, and rollback controls.

---

## 3. Non-Goals

* Do not parallelize internals of individual browser crawlers or subprocesses initially.
* Do not assume all providers support the same concurrency or rate.
* Do not add Redis, worker threads, distributed workers, or a new queue in V1.
* Do not batch LLM prompts before token, mapping, and partial-failure behavior is proven.
* Do not change hard-filter behavior during the scheduling work.
* Do not replace the existing daily pipeline.
* Do not make SMTP, email, or recipient configuration required for search results.
* Do not add unbounded retries or autonomous query expansion.

---

## 4. Adversarial Findings

### P0: Manifest work is duplicated

`job-search/orchestrator.ts` currently schedules every source ID. Each task
then finds all source IDs owned by the same manifest and passes that complete
group to `manifest.run()`.

This can invoke JobSpy, ATS, or Job Boards repeatedly while every invocation
searches the full group. The result is duplicated upstream work, inflated
provider traffic, misleading source status, and extra deduplication cost.

The existing pipeline already uses the correct pattern: group by manifest
first, then invoke one task per manifest group.

### P0: A global concurrency value is unsafe

Extractors include lightweight APIs, rate-limited APIs, browsers, Python
processes, Node subprocesses, authenticated providers, and shared filesystem
datasets. A single source concurrency value treats all of these as equivalent.

Some extractors also have process-level single-flight guards or fixed output
paths. Parallel runs can overwrite files, read another run's dataset, exhaust
browser memory, or trigger upstream throttling.

### P0: Background parsing changes cache admission

The current route parses before computing the semantic query hash. If parsing
moves to the background, a placeholder hash cannot safely be inserted and then
changed without handling races, `fresh`, expired cache rows, parser versions,
and concurrent identical requests.

The design needs a raw admission hash and a later semantic specification hash.

### P1: Incremental results can become order-dependent

A later source may provide a richer duplicate record. That can change whether
the job passes a strict filter, what is verified, and how it should be ranked.
Independent workers must not write competing JSON snapshots. One accumulator
must own mutable search state.

### P1: More ranking concurrency does not reduce request cost

The current ranking path resolves model settings and constructs an LLM service
per job. Replacing its loop with `asyncPool` improves scheduling but does not
reduce request count. Parallel requests also need shared rate limits, retry
budgets, timeouts, and per-job fallbacks.

### P1: The existing async pool is fail-fast

`asyncPool()` stops assigning work after an unexpected rejection. Search source
tasks need a settled-result policy so one unexpected provider error does not
stop unrelated providers. The global pool behavior should not be changed
without reviewing existing pipeline callers.

### P2: The current SSE contract cannot reconstruct partial state

Background parsing and partial results require explicit phases, sequence
numbers, provisional/final markers, bounded payloads, and a GET reconciliation
path after reconnects or missed events.

---

## 5. Target Architecture

```text
POST /api/job-search
  -> validate query
  -> compute raw admission hash
  -> atomically admit or reuse active search
  -> return searchId immediately
  -> background worker
       -> parse query
       -> persist spec and semantic hash
       -> build compatible manifest plan
       -> run manifest groups through bounded scheduler
       -> send completions to one accumulator
            -> deduplicate
            -> strict filter
            -> provisional deterministic snapshot
            -> partial SSE event
       -> final reconciliation
       -> final LLM ranking
       -> persist authoritative snapshot
       -> emit completed event
       -> attempt optional email
```

The design principle is:

> Parallelize independent I/O. Serialize state ownership. Keep deterministic rules outside the LLM.

---

## 6. Lifecycle and Admission

Keep the existing terminal status values where possible:

```text
running | completed | failed
```

Add a persisted phase:

```text
queued | parsing | planning | aggregating | filtering
| provisional_results | ranking | reporting | emailing | completed
```

Email failure must never transition a completed search to `failed`.

### Hashes

Add two identities:

* `admissionHash`: normalized raw query, explicit request options, parser version, and source-plan version. This is available before parsing.
* `specHash`: canonical parsed specification containing roles, skills, location, work mode, employment type, experience, salary, freshness, exclusions, seniority, industry, parser version, and source-plan version.

The current hash logic must include every field that changes search behavior.

### Schema changes

Modify `orchestrator/src/server/db/schema.ts` and `migrate.ts` additively.
Add:

| Field | Purpose |
|---|---|
| `admission_hash` | Duplicate admission before parsing |
| `spec_hash` | Semantic cache identity |
| `parser_version` | Parse invalidation |
| `source_plan_version` | Planner invalidation |
| `phase` | Current execution phase |
| `result_version` | Partial/final snapshot ordering |
| `last_progress_at` | Stale-run recovery |
| `source_plan` | Auditable manifest plan |
| `evaluation_time` | Frozen freshness boundary |

Use an active-search uniqueness policy, such as a partial unique index on
`(user_id, admission_hash)` for active rows. Completed rows remain available
for TTL lookup, while a fresh request receives a new run identity.

### POST behavior

`POST /api/job-search` must:

1. Validate the request.
2. Compute the raw admission hash.
3. Resolve a reusable active/recent search according to cache policy.
4. Insert a queued row atomically when needed.
5. Return `searchId` immediately with `parsedSpec: null`.
6. Start background work with captured request and user context.

The route must not perform the LLM parse, extractor discovery, or source work
before acknowledging the request.

---

## 7. Manifest Planning

Add `orchestrator/src/server/services/job-search/source-plan.ts`.

The planner will:

1. Load the extractor registry once.
2. Resolve available pipeline sources.
3. Apply country compatibility.
4. Check required credentials/environment variables.
5. Group source IDs by `manifest.id`.
6. Assign resource-group policies.
7. Persist the plan.

Proposed task shape:

```typescript
interface SearchManifestTask {
  manifestId: string;
  displayName: string;
  selectedSources: string[];
  resourceGroup: string;
  maxConcurrency: number;
  timeoutMs: number;
  status: "planned" | "running" | "succeeded" | "failed" | "skipped";
}
```

Each manifest must be invoked exactly once with its selected source group.
Manifest-level status and actual job source attribution must be preserved.
The report must distinguish successful zero-result sources, unavailable
sources, incompatible sources, and failed sources.

---

## 8. Resource-Aware Scheduler

Initial controls:

| Limit | Initial default | Maximum | Purpose |
|---|---:|---:|---|
| `jobSearchMaxActiveSearches` | 1 | 2 | Process protection |
| `jobSearchSourceConcurrency` | 3 | 6 | Manifest tasks per search |
| `jobSearchRankingConcurrency` | 4 | 8 | LLM ranking requests |
| `jobSearchMaxCandidates` | 500 | 2000 | Memory/filtering bound |
| `jobSearchMaxRankedCandidates` | 100 | 500 | LLM cost bound |
| `jobSearchSourceTimeoutMs` | 120000 | 300000 | Provider timeout |
| `jobSearchRankingTimeoutMs` | 30000 | 120000 | LLM timeout |

Resource groups should initially include:

| Group | Initial limit | Examples |
|---|---:|---|
| `api-light` | 4-6 | Direct ATS/API providers |
| `api-rate-limited` | 2-3 | Quota-sensitive providers |
| `browser` | 1-2 | Browser crawlers |
| `subprocess-heavy` | 1-2 | JobSpy, Adzuna |
| `auth-single-flight` | 1 | Authenticated crawlers |
| `shared-storage` | 1 | Non-isolated dataset writers |

Unknown manifests default to concurrency one.

Before enabling parallel runs, each shared-storage extractor must receive a
unique output directory, unique output filenames, or an explicit manifest
mutex. Otherwise it remains serialized.

Each scheduled task must enforce a timeout, abort where supported, release
its resource slot in `finally`, and return a structured failure result.

Do not change global `asyncPool()` fail-fast behavior. Use a search-specific
settled scheduler or non-throwing task wrapper.

---

## 9. Search Accumulator and Partial Results

Create `orchestrator/src/server/services/job-search/accumulator.ts` with one
owner per search:

```typescript
interface SearchAccumulator {
  evaluationTime: string;
  sourceResults: Map<string, ManifestTaskResult>;
  canonicalJobs: Map<string, CreateJobInput & { sources: string[] }>;
  filteredJobs: Map<string, FilterResult>;
  resultVersion: number;
}
```

Source workers submit completion messages. They do not mutate the accumulator
or write result snapshots directly.

Freeze `evaluationTime` once at search start. Use deterministic ordering:

1. Relevance score descending.
2. Posting timestamp descending when available.
3. Canonical job key ascending.

The first partial-result release should emit deterministic filtered candidates,
not provisional LLM scores. If provisional ranking is added later, every score
must carry the candidate content version and be invalidated when a richer
duplicate replaces the canonical record.

Avoid rewriting the large JSON result column after every job. The initial
implementation may keep partial state in memory and persist only the final
snapshot. If durable partial GET responses are required, use a single
debounced writer with `result_version` checks. Add normalized result-item tables
only if the JSON snapshot becomes a measured bottleneck.

---

## 10. LLM Ranking

The first ranking optimization is setup and scheduling, not prompt batching.

* Resolve runtime provider, model, base URL, and credential settings once per search.
* Reuse one `LlmService` instance per search.
* Add a shared provider/ranking limiter.
* Use a settled per-job scheduler.
* Keep deterministic hard filtering before every LLM call.
* Convert individual errors to deterministic fallback scores.
* Limit candidates, prompt description size, retries, and total ranking time.

Do not batch multiple candidates into one prompt until structured response
mapping, token limits, partial batch failure, and score equivalence are tested.

---

## 11. API, SSE, and UI

The immediate POST response remains within the existing API envelope:

```json
{
  "ok": true,
  "data": {
    "searchId": "...",
    "status": "running",
    "parsedSpec": null,
    "cached": false
  },
  "meta": { "requestId": "..." }
}
```

Extend `shared/src/types/job-search.ts` with:

* `parsing` and `planning` phases.
* Nullable parsed criteria during initial phases.
* `manifest_started` and `manifest_completed` events.
* `results_partial` events.
* `sequence` and `resultVersion` on state-bearing events.
* `provisional` versus final result markers.
* `email_skipped` in addition to sent and failed.

SSE is a notification channel, not the source of truth. The client must call
`GET /api/job-search/:id` after subscription, after a sequence gap, after
reconnect, and after completion.

Update `JobSearchPage.tsx` to:

* Show parsing progress while `parsedSpec` is null.
* Display source completion in completion order.
* Merge or reconcile provisional results.
* Label provisional results clearly.
* Always render results independently of email state.
* Keep email status as an auxiliary card.

---

## 12. Configuration

Add settings through `shared/src/settings-registry.ts` and
`shared/src/types/settings.ts`:

| Setting | Default | Maximum |
|---|---:|---:|
| `jobSearchMaxActiveSearches` | 1 | 2 |
| `jobSearchSourceConcurrency` | 3 | 6 |
| `jobSearchRankingConcurrency` | 4 | 8 |
| `jobSearchMaxCandidates` | 500 | 2000 |
| `jobSearchMaxRankedCandidates` | 100 | 500 |
| `jobSearchSourceTimeoutMs` | 120000 | 300000 |
| `jobSearchRankingTimeoutMs` | 30000 | 120000 |
| `jobSearchPartialResultsEnabled` | false | n/a |
| `jobSearchHighConcurrencyEnabled` | false | n/a |

Provider-specific safety limits should remain code-defined or environment-
controlled until the scheduler is proven. Do not expose unrestricted provider
concurrency to users.

---

## 13. Implementation Phases

### Phase 0: Baseline and instrumentation

Files:

* `orchestrator/src/server/services/job-search/orchestrator.ts`
* `orchestrator/src/server/services/job-search/ranking.ts`
* `orchestrator/src/server/services/job-search/progress.ts`

Measure POST latency, parse latency, manifest duration, manifest invocation
count, upstream calls, duplicate ratio, filter counts, ranking calls,
fallbacks, rate limits, database write time, payload size, time to first
source completion, and total duration.

Create a deterministic fixture baseline with source concurrency one. The
current duplicated source execution is not a valid performance baseline.

### Phase 1: Correct manifest planning

Files:

* New `orchestrator/src/server/services/job-search/source-plan.ts`
* New `orchestrator/src/server/services/job-search/source-runner.ts`
* Modify `orchestrator/src/server/services/job-search/orchestrator.ts`
* Modify `shared/src/types/extractors.ts` if execution metadata is added

Group sources by manifest, apply compatibility and credentials, snapshot
settings once, execute one task per manifest, and correct status attribution.

Tests must prove JobSpy, ATS, and Job Boards execute once with exact selected
source groups.

Exit criterion: final output matches the corrected serial fixture baseline and
manifest invocation count is correct.

### Phase 2: Resource-aware scheduler

Files:

* New `orchestrator/src/server/services/job-search/scheduler.ts`
* New `orchestrator/src/server/services/job-search/resource-limits.ts`
* Modify job-search orchestrator and extractor execution metadata
* Modify settings registry and settings types

Add active-search, per-search, resource-group, timeout, cancellation, and
shared-storage controls. Start with source concurrency three. Ramp to four and
then six only after observing provider and extractor safety.

Tests must cover limits, distinct concurrent searches, timeout cleanup, source
failure isolation, and shared-file collision prevention.

### Phase 3: Background parsing and admission

Files:

* `orchestrator/src/server/api/routes/job-search.ts`
* `orchestrator/src/server/services/job-search/query-parser.ts`
* `orchestrator/src/server/services/job-search/orchestrator.ts`
* `orchestrator/src/server/repositories/job-search.ts`
* `orchestrator/src/server/db/schema.ts`
* `orchestrator/src/server/db/migrate.ts`
* `shared/src/types/job-search.ts`
* `orchestrator/src/client/pages/JobSearchPage.tsx`

Add admission/spec hashes, parser/source-plan versions, phase, result version,
and stale-run recovery. Return immediately with a null parsed spec and update
the UI for background parsing.

Tests must cover fast acknowledgement, concurrent identical requests, fresh
requests, expired caches, parser fallback, and restart recovery.

### Phase 4: Ranking scheduler

Files:

* `orchestrator/src/server/services/job-search/ranking.ts`
* `orchestrator/src/server/services/job-search/orchestrator.ts`
* `orchestrator/src/server/services/modelSelection.ts` if runtime snapshot support is needed
* `orchestrator/src/server/services/llm/service.ts` if a shared limiter is needed

Resolve runtime configuration once, reuse the LLM service, add ranking limits,
use settled tasks, and preserve deterministic fallbacks. Do not introduce
batch prompts yet.

### Phase 5: Provisional result streaming

Files:

* New `orchestrator/src/server/services/job-search/accumulator.ts`
* Job-search orchestrator and progress modules
* `shared/src/types/job-search.ts`
* Job-search API route and client page

Process completions through one accumulator, emit bounded provisional
snapshots, add sequence/reconciliation behavior, and run final authoritative
deduplication and ranking after all manifests complete.

### Phase 6: Optional batching and caching

Add bounded LLM batch ranking, parser/source/ranking caches, versioned cache
keys, token budgets, and per-candidate validation only after final-result
equivalence is proven.

### Phase 7: Controlled rollout

Ramp source concurrency from one to three to six, ramp ranking independently,
monitor provider failures and memory/WAL behavior, and retain kill switches for
partial results and high concurrency.

---

## 14. Test Strategy

* Manifest-plan tests for grouping, exact selected sources, compatibility, credentials, and attribution.
* Extractor isolation tests for child processes, browsers, shared paths, and single-flight providers.
* Scheduler tests for per-search, process-wide, and resource-group limits.
* Timeout, cancellation, and slot-release tests.
* Parser lifecycle tests for admission, cache, fresh, fallback, and restart recovery.
* Accumulator permutation tests proving source arrival order does not change final results.
* Dedup replacement tests proving richer records invalidate affected provisional scores.
* Ranking tests for one-time runtime resolution, provider limits, retries, fallbacks, and hard-filter exclusion.
* SSE tests for null parsed specs, partial snapshots, reconnects, sequence gaps, and final reconciliation.
* Email tests proving no SMTP or email exceptions never remove UI results.
* Fixture-backed load tests at source concurrency one, three, and six.

---

## 15. Observability

Every relevant log must include `requestId`, `searchId`, `manifestId` or
`resourceGroup`, and duration/count fields. Do not log raw source responses,
full descriptions, LLM prompts, SMTP credentials, or full email payloads.

Track:

* `job_search_ack_latency_ms`
* `job_search_parse_latency_ms`
* `job_search_manifest_latency_ms`
* `job_search_time_to_first_result_ms`
* `job_search_total_latency_ms`
* `job_search_manifest_failures_total`
* `job_search_upstream_rate_limits_total`
* `job_search_ranking_requests_total`
* `job_search_ranking_fallbacks_total`
* `job_search_partial_snapshot_bytes`
* `job_search_stale_worker_writes_total`

---

## 16. Acceptance Criteria

1. POST acknowledgement does not wait for query parsing.
2. Each manifest executes exactly once per search.
3. Selected source groups are exact and auditable.
4. Incompatible and unavailable sources are skipped explicitly.
5. One source failure does not stop unrelated sources.
6. All-source failure is not presented as a successful empty search.
7. Final results are invariant to source completion order.
8. No stale worker overwrites a newer snapshot.
9. Filtered-out jobs never reach ranking.
10. LLM runtime configuration is not resolved per candidate.
11. Provider and resource limits are never exceeded.
12. Shared extractor output is isolated or serialized.
13. Partial results are marked provisional and reconciled.
14. Missing SMTP never prevents UI results.
15. The existing daily pipeline remains behaviorally unchanged.
16. All required CI-parity checks pass.

Performance targets for fixture environments:

* POST p95 below 500 ms.
* At least 30% lower p95 aggregation latency against the corrected serial baseline.
* First provisional result after the first successful manifest.
* No provider error/rate-limit regression during concurrency ramp-up.
* No ranking fallback regression against the existing concurrency-four baseline.
* Zero lost source statuses or results under concurrent completion tests.

---

## 17. Rollback Plan

Rollback is configuration-first:

1. Disable high-concurrency execution.
2. Disable partial-result streaming.
3. Set source concurrency to one or three.
4. Retain corrected manifest grouping with serial execution.
5. Preserve completed snapshots and email status.

Schema additions must be additive, nullable, or defaulted so the corrected
serial path can continue reading existing rows.

---

## 18. Decision Summary

Acceleration will be delivered in this order:

1. Correct duplicate manifest execution.
2. Add resource-aware bounded scheduling.
3. Move parsing to the background with explicit admission hashes.
4. Optimize ranking setup and provider coordination.
5. Add serialized provisional-result accumulation and SSE streaming.
6. Add LLM batching and caching only after final-result equivalence is proven.

The system will parallelize independent I/O while preserving single ownership
of mutable state, deterministic hard filtering, bounded LLM usage, optional
email, and safe rollback.
