# ADR-001: Introduce Agentic AI Orchestration into the Job Intelligence Platform

**Status:** Proposed (Revised)
**Date:** 2026-08-09
**Decision Type:** Architecture / AI Platform
**Scope:** Existing job-search and job-aggregation application
**Target:** Agentic Search Orchestrator v1

---

## 1. Context

The existing application provides a natural-language job-search experience through a deterministic pipeline: parse → search → normalize → dedup → filter → rank → report → email.

The pipeline works, but it cannot adapt when results are poor. If only 3 jobs pass strict filters, it stops. An agentic layer can reason about gaps and iterate.

**Constraint:** The existing system must remain reliable. Agentic behavior must not override hard business rules. The existing cron pipeline continues to operate independently.

---

## 2. Decision

Introduce a **controlled Agentic Search Orchestrator** as a parallel path alongside the existing job-search flow.

Architecture: **One agent + controlled tools + deterministic execution services + selective LLM components.**

We will **not** implement multi-agent, automatic applications, or unbounded autonomy in V1.

### Core Principle

> **Agents decide. Deterministic services enforce.**

The agent selects tools and decides iteration strategy. Existing services (filter, dedup, search, email) execute safely. The agent never directly accesses the database or bypasses business rules.

---

## 3. Alternatives Considered

| Option | Description | Verdict |
|--------|-------------|---------|
| **A. Monolithic Agent** | One LLM does everything | Rejected — hard to test, debug, enforce constraints |
| **B. Multi-Agent System** | Dedicated agents per capability | Deferred — no demonstrated bottleneck yet |
| **C. Agent + Tools + Services** | Agent orchestrates existing services via tools | **Selected** |

---

## 4. Integration Seam with Existing System

> [!IMPORTANT]
> This section defines exactly where the agentic layer connects to existing code.

### 4.1 Parallel Path — Not a Replacement

The agentic search is a **new orchestrator** that lives alongside [job-search/orchestrator.ts](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/server/services/job-search/orchestrator.ts). It does not replace or modify `executeJobSearch()`.

```
User query
    │
    ├── POST /api/job-search          → existing executeJobSearch() [UNCHANGED]
    │
    └── POST /api/agentic-searches    → NEW agenticSearchOrchestrator()
                                            │
                                            ├── calls parseSearchQuery()  [REUSE]
                                            ├── calls runSource()         [REUSE, extracted]
                                            ├── calls deduplicateJobs()   [REUSE]
                                            ├── calls filterJobs()        [REUSE]
                                            ├── calls rankJobs()          [REUSE]
                                            ├── calls verifyJobs()        [NEW]
                                            ├── iteration/coverage eval   [NEW, LLM]
                                            └── calls sendSearchEmail()   [REUSE]
```

### 4.2 Extraction Required

The following functions are currently private to `job-search/orchestrator.ts` and must be extracted into reusable modules:

| Function | Current Location | Action |
|----------|-----------------|--------|
| `runSource()` | `job-search/orchestrator.ts:66` | Extract to `job-search/source-runner.ts` |
| `resolveSources()` | `job-search/orchestrator.ts:52` | Extract to `job-search/source-resolver.ts` |

Everything else (`deduplicateJobs`, `filterJobs`, `rankJobs`, `parseSearchQuery`, `sendSearchResultsEmail`) is already importable.

### 4.3 Coexistence with Cron Pipeline

The daily cron pipeline ([pipeline-scheduler.ts](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/server/services/pipeline-scheduler.ts)) and the agentic search operate on **separate data paths**:

- **Cron pipeline**: discovers jobs → scores → stores in `jobs` table → PDF generation
- **Agentic search**: searches on-demand → stores results in `job_searches` + new `agentic_searches` tables

They share the same extractor registry and LLM service. Conflict is managed via LLM budget partitioning (Section 7).

---

## 5. Unknown Information Handling

> [!IMPORTANT]
> Reconciling the ADR principle with existing [filter.ts](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/server/services/job-search/filter.ts) behavior.

The existing filter **passes** jobs with unknown constraint values but flags them as `unverified`:

```typescript
// filter.ts:59-60 — current behavior
return { matches: true, verified: false };
```

This is the correct pragmatic behavior. The rule is:

> **Unknown = Pass-Through + Flag, not Match or Reject.**

Jobs with unverified constraints appear in results with an explicit `unverifiedConstraints` list. The agentic layer's value-add is that it can **choose to verify** these unknowns before final ranking, upgrading them to verified or rejected.

The existing filter behavior is **unchanged**. The agentic layer adds a verification step that the deterministic pipeline doesn't have.

---

## 6. Agent Tool Interface

| Tool | Data Source | Wraps Existing | Expected Latency | Cost | V1 Scope |
|------|-----------|---------------|-------------------|------|----------|
| `parse_search_query` | LLM | `query-parser.ts` | 2-3s | ~$0.002 | ✅ |
| `search_jobs` | Extractor APIs | `runSource()` | 5-15s | free | ✅ |
| `get_job_details` | DB (cached) | `jobSearchRepo` | <50ms | free | ✅ |
| `filter_jobs` | Deterministic | `filterJobs()` | <100ms | free | ✅ |
| `deduplicate_jobs` | Deterministic | `deduplicateJobs()` | <100ms | free | ✅ |
| `rank_jobs` | LLM | `rankJobs()` | 10-30s | ~$0.10 | ✅ |
| `verify_job` | LLM + cached data | **NEW** | 2-5s | ~$0.005 | ✅ |
| `evaluate_coverage` | LLM | **NEW** | 1-2s | ~$0.005 | ✅ |
| `get_candidate_profile` | DB | `getProfile()` | <100ms | free | ✅ |
| `save_search` | DB | `jobSearchRepo` | <50ms | free | ✅ |
| `send_search_email` | SMTP | `sendSearchResultsEmail()` | 1-3s | free | ✅ |
| `search_company_jobs` | Extractor APIs | **NEW** | 5-15s | free | Phase 3 |

Each tool has: typed input/output, timeout (30s default), rate limit, retry policy (1 retry for LLM, 0 for DB), and audit logging via the shared logger.

### Verification Tool Detail

The `verify_job` tool operates on **cached data only** in V1. It does NOT scrape external pages. It receives the job's existing fields (description, metadata, source data) and uses the LLM to infer whether a specific constraint is met:

```typescript
interface VerifyJobInput {
  jobId: string;
  constraint: string;        // e.g., "remote", "experience:4-6"
  jobData: Partial<CreateJobInput>;  // relevant fields only
}

interface VerifyJobOutput {
  status: "verified" | "not_verified" | "contradicted" | "unknown";
  confidence: number;        // 0-1
  evidence: string;          // explanation
}
```

---

## 7. Concurrency and Resource Model

### Worker Pool

Agentic searches run as background tasks using the same `runWithRequestContext` pattern as existing search. A separate in-memory concurrency gate limits simultaneous agentic searches:

```
AGENTIC_SEARCH_CONCURRENCY = 2  (default, configurable via settings)
```

This is independent of `SEARCH_CONCURRENCY = 3` used inside each search for source parallelism.

### LLM Budget Partitioning

The existing [LlmService](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/server/services/llm/service.ts) uses key rotation and rate-limit tracking. The agentic layer shares this infrastructure but adds per-search budgets:

| Resource | Per-Search Limit | Rationale |
|----------|-----------------|-----------|
| LLM calls | 30 | Covers parse + 5 iterations × (coverage eval + 3 verifications) + rank |
| Total tokens | 100,000 | ~$0.50 at typical pricing |
| Execution time | 5 minutes | Hard wall-clock cutoff |
| Search iterations | 5 | Prevents runaway loops |
| Verification calls | 20 | Bounded per iteration |

### Cost Model

```
ESTIMATED COST PER AGENTIC SEARCH (worst case):
  Query parsing:          ~$0.002
  Coverage evaluation:    ~$0.005 × 5 iterations    = $0.025
  Verification:           ~$0.005 × 20 jobs          = $0.10
  Ranking:                ~$0.003 × 30 jobs           = $0.09
  Report generation:      ~$0.015
                                          Total: ~$0.23/search

At 100 searches/day:  ~$23/day   = ~$690/month
At 500 searches/day:  ~$115/day  = ~$3,450/month
```

These estimates assume a mid-tier model (GPT-4o-mini / Claude Haiku class). The `LlmProvider` abstraction and `resolveLlmModel()` allow per-task model selection to reduce cost.

---

## 8. State Machine

### States

```
CREATED → PLANNING → SEARCHING → NORMALIZING → DEDUPLICATING →
FILTERING → EVALUATING → VERIFYING → REFINING → RANKING →
REPORTING → COMPLETED
```

Terminal states: `COMPLETED`, `FAILED`, `PARTIAL`, `CANCELLED`, `TIMED_OUT`

### Resume Semantics

**Strategy: Idempotent step replay.** Each step checks what's already persisted before executing:

```typescript
// Pseudocode for each step
async function executeStep(searchId: string, step: Step) {
  const existing = await getStepResult(searchId, step.id);
  if (existing?.status === "completed") return existing.result;
  
  await updateStepStatus(searchId, step.id, "running");
  const result = await step.execute();
  await saveStepResult(searchId, step.id, result);
  return result;
}
```

**Stale detection:** On server restart, `markOrphanedSearchesAsFailed()` (already exists in [job-search.ts:193](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/server/repositories/job-search.ts#L193)) is extended to also mark orphaned agentic searches as `FAILED`.

No heartbeat/lease mechanism in V1. If the process dies, the search is marked failed on restart. This matches the existing pipeline's behavior.

---

## 9. Search Expansion Safety

Expansion of search terms is limited to **soft dimensions only** (job title synonyms). Hard constraints (location, remote, experience, date) are never expanded.

**Guardrail:** The agent's expanded terms are logged and included in the results for transparency. The system adds a `searchExpansions` field to the results:

```json
{
  "originalTerms": ["Data Engineer"],
  "expandedTerms": ["Data Platform Engineer", "Data Infrastructure Engineer"],
  "expansionReason": "Semantic variations to improve coverage"
}
```

Users can review what terms were searched. Future: allow users to approve/reject expansions before execution.

---

## 10. Progress Streaming

Reuses existing SSE infrastructure ([sse.ts](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/server/infra/sse.ts), [progress.ts](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/server/services/job-search/progress.ts)).

New SSE endpoint:

```
GET /api/agentic-searches/:id/progress
```

Uses the same `setupSse()` / `writeSseData()` / `startSseHeartbeat()` helpers. Progress event types extend the existing `JobSearchProgressEvent` union with agentic-specific events:

```typescript
| { type: "agent_iteration"; searchId: string; iteration: number; maxIterations: number; reason: string }
| { type: "agent_verification"; searchId: string; jobsVerifying: number; jobsVerified: number }
| { type: "agent_expansion"; searchId: string; expandedTerms: string[] }
```

---

## 11. Database Changes

New tables in the existing SQLite/Drizzle schema ([schema.ts](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/server/db/schema.ts)):

### `agentic_searches`

```sql
id                  TEXT PRIMARY KEY
user_id             TEXT NOT NULL DEFAULT 'default-user'
original_query      TEXT NOT NULL
query_hash          TEXT NOT NULL
status              TEXT NOT NULL DEFAULT 'created'    -- state machine value
goal                TEXT (JSON)                        -- parsed goal
hard_constraints    TEXT (JSON)
soft_preferences    TEXT (JSON)
search_plan         TEXT (JSON)                        -- current plan
current_step        TEXT
iteration_count     INTEGER DEFAULT 0
max_iterations      INTEGER DEFAULT 5
results             TEXT (JSON)                        -- final results
budget_used         TEXT (JSON)                        -- token/cost tracking
started_at          TEXT
completed_at        TEXT
failure_reason      TEXT
created_at          TEXT NOT NULL DEFAULT datetime('now')
updated_at          TEXT NOT NULL DEFAULT datetime('now')

INDEX idx_agentic_searches_user_status ON (user_id, status)
INDEX idx_agentic_searches_user_hash ON (user_id, query_hash)
```

### `agentic_tool_calls`

```sql
id                  TEXT PRIMARY KEY
search_id           TEXT NOT NULL REFERENCES agentic_searches(id) ON DELETE CASCADE
tool_name           TEXT NOT NULL
arguments_summary   TEXT                              -- sanitized, not raw
result_summary      TEXT
status              TEXT NOT NULL DEFAULT 'pending'
latency_ms          INTEGER
iteration           INTEGER NOT NULL DEFAULT 1
created_at          TEXT NOT NULL DEFAULT datetime('now')

INDEX idx_agentic_tool_calls_search ON (search_id)
```

### `job_verifications`

```sql
id                  TEXT PRIMARY KEY
search_id           TEXT REFERENCES agentic_searches(id) ON DELETE SET NULL
job_url             TEXT NOT NULL                     -- job URL as FK proxy
constraint_key      TEXT NOT NULL                     -- e.g., "remote", "experience"
status              TEXT NOT NULL                     -- verified/not_verified/contradicted/unknown
confidence          REAL
evidence            TEXT
verified_at         TEXT NOT NULL DEFAULT datetime('now')

INDEX idx_job_verifications_job_url ON (job_url)
UNIQUE idx_job_verifications_job_constraint ON (job_url, constraint_key)
```

**Note:** Candidate profile data reuses the existing [profile.ts](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/server/services/profile.ts) service. No separate `candidate_profiles` table — the existing Design Resume / RxResume profile IS the candidate profile.

---

## 12. API Design

```
POST   /api/agentic-searches              — Start an agentic search
GET    /api/agentic-searches              — List recent agentic searches
GET    /api/agentic-searches/:id          — Get search status + results
GET    /api/agentic-searches/:id/progress — SSE progress stream
POST   /api/agentic-searches/:id/cancel   — Cancel a running search
```

Follows existing API response contract from AGENTS.md: `{ ok, data/error, meta: { requestId } }`.

---

## 13. Safety

| Control | Implementation |
|---------|---------------|
| Kill switch | `AGENTS_ENABLED` setting, checked at API entry |
| Fallback | On agent failure, fall back to existing `executeJobSearch()` |
| Tool allowlist | Agent receives only tools defined in Section 6 |
| No DB access | Agent calls tools; tools call repositories |
| Auth propagation | `runWithRequestContext` carries user identity |
| Cost limits | Per-search budget (Section 7), enforced by orchestrator |
| Cancellation | `POST .../cancel` sets status to `CANCELLED`, checked between steps |
| Prompt injection | Job descriptions are passed as structured data fields, never as system instructions |

---

## 14. Feature Flags

```
agenticSearchEnabled          — master toggle
agenticVerificationEnabled    — toggle verification step
agenticRefinementEnabled      — toggle iterative refinement
agenticPersonalizationEnabled — toggle profile-based ranking
```

Stored in existing `settings` table, managed through existing settings UI.

---

## 15. Migration Strategy

1. Extract `runSource()` and `resolveSources()` from existing orchestrator → pure refactor, no behavior change
2. Add new DB tables via migration in `migrate.ts`
3. Implement agentic orchestrator behind `agenticSearchEnabled = false`
4. Shadow mode: run agentic search alongside existing search, compare results (no user impact)
5. Internal testing with `agenticSearchEnabled = true`
6. Gradual rollout

---

## 16. Consequences

**Positive:** Adaptive search, iterative refinement, verification of unknowns, personalized ranking, explainable matches, future scout/application capabilities.

**Negative:** LLM costs (~$0.23/search), additional latency (30s-5min vs 15-45s), more state management, new failure modes, model variability.

Accepted because adaptive search and verification provide meaningful product value over the current one-shot pipeline.

---

## 17. Explicitly Rejected

- Replace deterministic filters with LLM decisions
- One agent per job source
- Agent directly accessing database
- Automatic application submission in V1
- Unlimited autonomous search
- Long-term memory of everything
- Multi-agent architecture immediately
- Separate candidate_profiles table (reuse existing profile service)
