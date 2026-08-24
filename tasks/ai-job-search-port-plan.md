# Porting MadsLorentzen/ai-job-search into Job Ops — Deep Analysis & Implementation Plan

Date: 2026-08-23
Source project: https://github.com/MadsLorentzen/ai-job-search (MIT, ~33k stars, Python language stat but actually a Claude Code *workflow framework*: markdown skills + slash commands + portal CLIs)
Target: this repo (`job-ops`) — multi-tenant Express/React/SQLite app.

> **Status of this document:** Complete. Part 1 (source analysis) is built from primary reads of the source repo's command/skill files; Part 2 (gap map) is reconciled against a full capability sweep of this repo (2026-08-23, isolated explore agent, file-path evidence per claim); Part 3 is the sequenced implementation plan.

---

## Part 1 — What the source project actually is

It is **not an importable library**. There is no reusable SDK; the runtime is a Claude Code agent executing markdown instructions. What is portable is the *workflow logic*: the evaluation framework, drafting/review pipeline, verification loops, state discipline, and trust rules. Every candidate feature below re-expresses one of those as an app feature (deterministic code + LLM service calls), not a copy of files.

### 1.1 Command-by-command inventory

| Command / Tool | What it does | Mechanics worth porting |
|---|---|---|
| `/setup` | Profile onboarding, 3 paths (documents folder, CV import, interview) | Calibration from past outcomes into the fit framework; cross-reference consistency checks; language capture **with proficiency levels**; search queries keyed by *function* not title; proactive role-type suggestions |
| `/scrape` | Multi-portal search + dedupe | Contract-pinned CLI output (`title/company/location/date/url` per result), `deadline` captured at first sight, provenance field (`cli` vs `websearch` fallback) |
| `/rank` | Batch triage scoring into ranked shortlist | 4 weighted dimensions (Tech 30 / Exp 25 / Behavioral 15 / Career 30) + **location veto** + **language gate (PASS/FAIL/FLAG)** + deadline urgency (🔥 ≤7d wins ties) + **deadline expiry sweep** (auto-retire past-deadline postings, reversible); per-job persisted `strengths`/`gaps`; triage-vs-full-eval distinction; idempotent re-scoring |
| `/apply` | Flagship drafter-reviewer application pipeline | See 1.2 — this is the crown jewel |
| `/outcome` | Record application outcomes + follow-ups | Canonical status vocabulary (open/final, legacy read-compat); **follow-up branch**: quiet ≥10d (configurable), **max 2 follow-ups**, drafts only never sends, 60–120 words, channel-shaped (email/LinkedIn/portal), **no new claims beyond archived submitted docs**; thank-you-note trigger on interview stage; days-quiet math from dated notes |
| `/gmail-sync` | Classify inbox signals → propose → approve → write | Signal table (ack → drafted→applied; assessment/interview → stage; offer → offer, **never hired/declined**; rejection → rejected); source-email citation on every write; user approval batch; conflict → manual review, never overwrite; idempotent by message ID; 30-day staleness *surface-only* flag |
| `/interview` | Stage-specific prep pack + mock interview | Prep from archive (posting + submitted docs + prior feedback); likely-question derivation order (recorded feedback → fit gaps → posting requirements → stage type); **STAR mapping with "Use for" tags**; **consistency brief** ("no claim in the room that isn't on the paper, every claim on paper defensible in depth"); customized tough questions; verified company research; roleplay protocol with per-answer feedback calibrated to behavioral profile |
| `/expand` | Profile enrichment from documents + public presence | Scans CV/LinkedIn/diplomas/references + GitHub repos/portfolio/Kaggle/Scholar; course syllabi lookup; competency map with provenance tags; **additive only, user-confirmed before write**, idempotent via source annotations |
| `/upskill` | Skill-gap heatmap + learning plan | Fit-weighted skill frequency; **recorded gaps beat inferred skills**; LLM synthesis pass for domain/soft/tooling/credential gaps; 2–3 web-searched resources per gap (current-year queries); tailored study direction off existing background; study order w/ dependencies & quick wins; period-over-period report diff (gaps closed / new gaps) |
| `/html-report` | Offline self-contained dashboard | Inline-SVG charts, no deps, HTML-escaping discipline — *mostly superseded by our web UI* |
| `/notion-sync` | One-way Notion DB view | Write-once page bodies, upsert by key, documents as filenames only, status vocabulary normalization — *niche* |
| `/add-template` | Register custom CV/cover-letter template | Any compile-to-PDF toolchain; `[PLACEHOLDER]` tokens (shareable); **mandatory test compile before activation**; manifest (engine, fonts, page limit, pitfalls); managed activation block |
| `/add-portal` | Generate a job-board search CLI | Live investigation before scaffolding; robots.txt + ToS gate (auth-walled = decline); honest UA convention; zero-dep default; mandatory live test run — *our dynamic extractors already cover the runtime side; only the generator workflow is novel* |
| `/reset` | Wipe profile/documents | Typed confirmation — trivial / we have equivalents |
| `salary_lookup.py` + `convert_salary_excel.py` | Salary benchmarking against BYO data | JSON format w/ baseline metadata; fuzzy company matching (legal suffixes, Nordic chars); Excel converter with locale-safe number parsing ("last separator is decimal"); never-guess policy for ambiguous cells |
| `09-web-research.md` | Fetch escalation doctrine | **robots.txt gate before** browser-header retry; snippet = lead not source; prefer employer's own posting over aggregator (req ID + grade survive there); `#fragment` URLs = listing pages, treat as failed fetch; login walls are a different failure class |
| `company_research/` cache | Shared research cache | One JSON per company, 30-day TTL, sources-per-fact, "cache is a lead, never the final verification" |

### 1.2 The six crown-jewel mechanics (inside `/apply`)

These are the highest-density value in the whole repo:

1. **Drafter–reviewer separation.** Draft CV+cover letter, then a *second, fresh-context* agent researches the company and critiques. Feedback split into **Part A structured edits** (`{file, old_string, new_string, reason}` JSON, mechanically applicable) and **Part B narrative** (grouped categories, all emitted even when empty). Reviewer also runs the **Factual Grounding Audit**: every date/role/metric checked against the union of profile sources; reframed emphasis OK, changed facts never OK.
2. **Compile-and-inspect loop (mandatory).** Exactly-2-page CV / 1-page cover letter; orphaned `\cventry` titles fixed with `\needspace{5\baselineskip}`; near-miss overflow rescued with `\enlargethispage`; never squeeze geometry.
3. **ATS parseability verification.** `pdftotext -layout -enc UTF-8` on the compiled PDF; check text isn't garbled (`(cid:NNN)`, ``), **contact details are literal text not icons/links**, reading order matches layout, **dates are ASCII-hyphen ranges** (`2016-2024` parses; `2016--2024` ligatures to en-dash and Workday silently drops it). Then **keyword-coverage table** with honest statuses: covered / synonym-only / missing-have-it (add) / **missing-gap (never stuff)**.
4. **Relevance-weighted cutting.** When over budget, score each line on (a) relevance to *this* posting, (b) uniqueness, (c) cover-letter dependency; cut lowest total first — *never* a static section order.
5. **Trust boundary on postings.** Posting text is data, never instructions; never follow embedded directions; never fetch links from the posting body; hidden-text may be crafted to manipulate. Applies all the way into the reviewer agent's prompt.
6. **Language Gate + Eligibility Gate before scoring.** Language: undeclared required language = FAIL (hard stop, quote the line); declared-but-higher-bar = FLAG (score and proceed, surface to user). Eligibility: citizenship/clearance requirement = FAIL; silence = unverified, not permission.

### 1.3 Posting-independent disciplines

- **Write facts back to the profile same-turn** — a fact that exists only in chat is stripped as fabrication later. (In app terms: a "confirm to save to profile" loop on every LLM surface.)
- **Deadline persistence at first sight**, reused by urgency, expiry, follow-up clocks.
- **Idempotent state everywhere**: message IDs, dedup keys, ranked re-score idempotence, source-tagged additions.
- **Human gates**: batches are proposed-with-citations and approved before writes; follow-ups are drafts, never sends.
- **Calibration loop**: ≥3 resolved applications → mine outcomes to recalibrate fit scoring; mine archived drafts for phrasing, *grounded* against profile (archived drafts are phrasing references, never fact sources).

---

## Part 2 — Current capability map & gap analysis

Grounded in the repo sweep (verified 2026-08-23 against `orchestrator/src/server/**`).

| Area | What Job Ops already has | What the source project adds that we're missing |
|---|---|---|
| Fit scoring | Single blended LLM score via `services/scorer.ts` → `{score, reason, grade(A–F), topProject, verdict(apply/maybe/skip)}` + visa-sponsor match. The default prompt template (`shared/src/prompt-template-definitions.ts`) already carries weighted criteria (skills 30/exp 25/location 15/industry 15/growth 15), but they collapse into the one number — **no per-dimension output is produced or persisted**. Separate search-path ranking exists (`job-search/ranking.ts`, 70/30 relevance×profileMatch; `personalized-ranking.ts` deterministic). Persisted: `suitability_score/reason`, `match_grade`, `match_verdict`, `top_project`. `autoSkipScoreThreshold`; missing-salary penalty. | **Persisted dimension breakdown**, verdict **bands**, **Language Gate** (PASS/FAIL/FLAG), **location veto**, **eligibility gate**, per-job **persisted strengths/gaps**, honest-gap presentation. (`user_profiles.languages` exists but is **never read** by scoring.) |
| Profile | `user_profiles` table w/ skills, experience, projects, `languages` JSON (plain list, **no levels**), links, file upload + resume-parser. Writing-style service for tone. | **Languages with proficiency levels**; **STAR example bank**; behavioral profile (thrive/drain, energizers); career goals + **deal-breakers** as first-class data; **calibration from outcomes**; **enrichment from public sources**. |
| Resume/CV | Tailored PDF via LaTeX (Tectonic) or RxResume (v4/v5), project selection, tailoring overrides, `pdf-tailoring` tests, Design Resume visual editor. | **Reviewer pass** (2nd-context critique + grounding audit + structured edits), **company research informed drafting**, **page-budget enforcement**, **relevance-weighted cutting**, **ATS text-layer verification**, **custom user templates**, application-form third artifact. |
| Cover letters | Ghostwriter LLM chat (threads/messages/runs, regeneration, style directives, snapshots, language matching) can produce a cover letter conversationally. | **A dedicated drafter→reviewer→compiler cover-letter flow** as a pipeline artifact (parallel to the resume PDF), forward-looking framing rules, posting-term keyword mapping — mostly covered by A4+A5+A6 rather than a separate letter engine. |
| Job search | NL query parsing, meta-search (parallel sources), dedup fingerprints, dynamic extractor registry (24 workspaces), ranking, import-to-tracked, schedules (hourly/daily). | **Deadline capture at first sight + urgency + expiry sweep**; employer-site preference over aggregators; fetch-escalation doctrine formalization. |
| Tracking | `stage_events` (incl. `metadata.eventType=interview_log`), stage transitions with regression protection (`applicationTracking.ts`, STAGE_ORDER); post-application Gmail ingestion + LLM classification → `pending_user` **approval flow exists** (Tracking Inbox + review service); outcomes on jobs. ⚠️ `tasks` table has **no writer** and `interviews` table is **dead schema** — `stage_events` is the real chronological store. | **Follow-up assistant** (quiet ≥10d, max 2, drafts-only, channel-shaped, thank-you trigger); staleness surfacing (30d signal-only); calibration handoff. Follow-up/staleness clocks derive from `stage_events.occurred_at`, nothing computes days-quiet today. |
| Interview prep | `interviews` table stores scheduling metadata only. | **Entire feature missing**: stage-specific prep packs, STAR mapping, consistency brief, customized tough questions, questions-to-ask, mock-interview roleplay. |
| Company research | None. | Research service + TTL cache + verify-before-use; feeds reviewer pass, prep packs, ghostwriter. |
| Salary | Jobs carry salary fields from extractors; visa-sponsors (H1B/LMIA) datasets exist. No benchmarking. | BYO salary dataset import + fuzzy company match + benchmark shown at evaluation time. |
| Skill gaps | Personalized ranking notes; recording per-job gaps absent. | Upskill aggregate gap heatmap + learning plan with web-searched resources. |
| Notifications | Webhooks, SMTP email, Telegram on pipeline/search events. | Reusable as delivery channel for follow-up nudges and prep reminders (no new transport needed). |
| MCP | MCP server over existing services. | Expose new features as MCP tools where useful (low marginal cost). |
| Trust/safety | Webhook SSRF basics; sanitization helpers. | **Untrusted-posting trust boundary** for all LLM prompts; robots.txt-gated retry doctrine in crawler. |

### Deliberately excluded

- `/html-report` — our web UI (tracking board, jobs pages, stats) supersedes a static dashboard.
- `/notion-sync` — one-way Notion view; niche. If desired later it is a new notification/export channel, not core.
- `/reset` — settings/profile management already covers deletion.
- `/add-portal` generator — our extractors are already runtime-discovered packages; a *generator* belongs to agent tooling, not the app. (A future MCP/agent tool could scaffold extractors; out of scope here.)
- Upstream-fork maintenance tools (`check_upstream_updates.py`, `upstream_triage.py`) — concerns of that template's forks, not this app.

---

## Part 3 — Implementation plan

Legend — effort: **S** < ~150 LOC net, **M** ~150–500, **L** > 500 / touches pipeline architecture. Every item ships with: typed `shared` contracts, `{ok,data/error,meta.requestId}` routes, tenant scoping, regression tests, and a `docs-site/docs/features/<name>.md` page using the repo's standard structure (What it is / Why / How to use / Common problems / Related pages, with frontmatter).

Conventions used below: "repositories/X" / "services/X" = `orchestrator/src/server/...`; "shared/X" = `shared/src/...`.

### Phase A — Application quality core (the crown jewels)

#### A1. Structured fit evaluation with gates (Effort: L, depends on nothing)

**What:** Replace the single blended score with a structured evaluation: four weighted dimensions (technical 30%, experience 25%, behavioral 15%, career 30%), PASS/FAIL/FLAG **language gate**, PASS/FAIL **location/logistics** verdict, eligibility screen when the profile declares permit status, verdict bands (Strong/Good/Moderate/Weak/Poor at 75/60/45/30), and persisted per-job `strengths`/`gaps` arrays.

**Design:**
- `shared/src/types.ts`: extend `Job` with `score_breakdown` JSON shape `{ technical, experience, behavioral, career, overall, band, locationVerdict, languageGate, languageNote?, eligibilityNote?, strengths[], gaps[], evaluatedAt }`.
- `services/scorer.ts`: extend `SCORING_SCHEMA` with the new fields (structured-output schema keeps it deterministic); weights + bands in `shared/scoring-weights.ts` so ranking and UI share one source.
- `db/schema.ts` + migrations: `jobs.score_breakdown TEXT` (JSON). Keep `suitability_score` as the weighted overall (back-compat with sorting/import paths).
- Pipeline `score-jobs.ts`: persist breakdown; auto-skip still keys off the overall score.
- Gates evaluated **before** content scoring server-side where determinable; LLM handles fuzzy language/level judgment with the rule text embedded in the prompt (FLAG > silent PASS when unsure).
- Client: score badge on job rows expands to dimension table + gate badges + strengths/gaps; `OrchestratorPage` + `JobSearchPage` share a `ScoreBreakdown` component.
- Settings: dimension weights editable? No — keep fixed v1 (documented); gates need config only for **location constraints** (home location, acceptable radius/remote policy) and **relocation = veto** toggle.

**Tests:** scorer schema parsing, band mapping, gate verdicts (undeclared language FAIL; higher-level FLAG; absent location FAIL when relocation), persisted strengths/gaps round-trip, cached-score passthrough.

#### A2. Profile languages-with-levels + deal-breakers (Effort: M, feeds A1)

**What:** Upgrade `user_profiles.languages` to `[{name, level}]` (free-text level: native/fluent/B2/…), add `dealBreakers` JSON (free-form lines like the source's evaluation section) and `careerGoals`/`energizers`/`drainers` to the profile schema; profile editor UI extended; these feed the A1 gate + tailoring.

**Design:** schema-only change (JSON columns, no new tables); profile service merge helpers; `UserProfilePage` sections; scorer + ghostwriter context builders include them. Migration: none needed beyond column addition `user_profiles.deal_breakers TEXT`, `career_goals TEXT`, `behavioral_notes TEXT`.

**Tests:** settings/profile round-trip, gate reads levels correctly, migration on existing rows.

#### A3. Deadline capture + urgency + expiry sweep (Effort: M, depends on nothing)

**What:** Deadline was captured at discovery (`jobs.deadline` exists, partial coverage) but never *used*. Add: extraction fallback during scoring when missing (LLM reads posting text for an explicit deadline, ISO only, never guessed); UI urgency markers (🔥 ≤7 days, wins tie-sort); a scheduled sweep marking `discovered/ready` jobs `expired` once deadline passes (reversible: re-discovery or manual re-open clears); "Closing soon" surface on the jobs page.

**Design:**
- `services/deadline.ts`: parsing helpers (defensive: non-ISO = absent, logged once with source), urgency computation, sweep function.
- Sweep wiring: a new daily task in `pipeline-scheduler` family or a lightweight `deadline-sweep` timer alongside `search-scheduler` (same owned-timer pattern from the recent scheduler fix).
- Client: date badge + sort tie-break on jobs list; filter pill "Closing soon".

**Tests:** parsing edge cases (ASAP, DD.MM.YYYY, empty), sweep flips only past-deadline open jobs, urgency boundaries at exactly 7 days, re-open clears expired.

#### A4. Drafter–Reviewer pass (review + grounding audit) (Effort: L, depends on A5 for research input)

**What:** After tailoring produces the draft resume/cover text, a second LLM call with fresh context critiques it: (a) **factual grounding audit** — every date/role/metric in the draft must trace to the profile (union of profile JSON + parsed master resume); (b) structured edits `[{file, oldString, newString, reason}]` applied mechanically; (c) narrative notes. Then revise and continue.

**Design:**
- `services/application-review.ts`: builds reviewer prompt (posting + draft + profile union + writing-style rules) → parses structured edits (zod-validated) → applies via exact-match replacement (fail-safe: unmatched `oldString` → surface in report, never fuzzy-apply) → returns revised draft + edit report.
- Grounding audit: deterministic pre-pass extracts candidate facts (dates, titles, metrics via regex+profile index) and flags unsupported tokens; LLM pass covers judgment calls. Claims found unsupported are *removed or softened*, reported with `reason: "grounding"`.
- Wiring: optional pipeline toggle `enableReviewerPass` (default off — cost); ghostwriter "Review this draft" action reuses the same service on demand.
- Report persisted on the job (`jobs.review_report TEXT` JSON) so users see what changed and why.

**Tests:** edit application exact/unmatched behavior, grounding removal path, JSON schema rejection, toggle off = previous byte-identical behavior.

#### A5. Company research service + cache (Effort: M, standalone)

**What:** Per-company research with **30-day TTL cache** and source-per-claim records; used by A4 reviewer, B1 prep packs, and ghostwriter context.

**Design:**
- `company_research` table: `id, user_id, company_key (normalized), company, fetched_at, payload_json (sources{website,reviews,linkedin,media}+notes), created/updated`. Unique `(user_id, company_key)`.
- `services/company-research.ts`: normalize name (lowercase, strip legal suffixes — reuse salary fuzzy-normalizer from B4); cache check → miss → research via LLM with search/crawler fetch of the *official site* (never links from the posting); store; expose `getCompanyResearch(company)`.
- Verify-before-use: payload stores per-claim source URLs; consumers instructed (prompt-level) that cache is a lead and claims cited in generated text must carry the source the cache recorded.
- API: `GET /api/company-research/:company` (cached) + `POST /api/company-research/:company/refresh`.
- UI: research card on job page.

**Tests:** TTL expiry, normalization collisions (A/S, Inc.), cache hit avoids fetch, payload schema.

#### A6. ATS parseability verification (Effort: M, depends on PDF pipeline)

**What:** After PDF compile, extract the text layer and verify what an ATS sees; report per-check results on the job page and pipeline summary.

**Design:**
- Optional dependency `pdftotext`/`pdfinfo` (poppler): presence probed once (`pdftotext -v`); absent → checks degrade to "visual-only" with a note (same graceful pattern the source uses). Docker image + setup-server.sh gain `poppler-utils` (tiny).
- `services/ats-check.ts`: run extraction (`-layout -enc UTF-8`), checks: (1) extraction non-garbled (no `(cid:NNN)`, no U+FFFD runs), (2) email/phone present as literal text, (3) reading order heuristic (headings in expected sequence), (4) **every date range uses ASCII hyphen** with start+end, (5) **keyword coverage** vs posting with 4 honest statuses (covered / synonym-only / missing-have-it → suggest add / missing-gap → never stuff).
- Fix the LaTeX renderer templates proactively: date args as `2016-2024` (single hyphen), contact prints literal text alongside icons.
- Persist `jobs.ats_report TEXT` JSON; surface in PDF download UI + pipeline run summary.

**Tests:** fixture PDFs generated by the LaTeX renderer (pdftotext available in CI via poppler-utils), each check's pass/fail paths, graceful-degrade path.

#### A7. Page-budget + layout loop for LaTeX renderer (Effort: M, depends on A6's pdf tooling)

**What:** Enforce a 2-page budget on compiled CVs; iterate: near-miss (`≤2.2 pages`) → `\enlargethispage` rescue; real overflow → **relevance-weighted re-cut instruction** fed back to the tailoring LLM (3-factor rule: posting relevance, uniqueness, cover-letter dependency); recompile and re-check; orphan-title detection via text-layer analysis (entry title on last line of page 1 with body on page 2 → insert `\needspace{5\baselineskip}`).

**Design:** `services/resume-renderer/layout-loop.ts`: compile → page count (`pdfinfo`/pdftotext `\f`) → fix-up strategy chain (enlargethispage → needspace injection at orphan → LLM re-cut with weighting rules) → bounded iterations (max 3) → report. Applies to the LaTeX renderer path; RxResume path is browser-layout and out of scope.
**Tests:** fixture documents at 1/2/3 pages, orphan fixture, iteration cap respected, never compresses geometry.

#### A8. Follow-up assistant (quiet applications) (Effort: M, depends on nothing but stage events)

**What:** Surface open applications gone quiet (default 10 days after last dated event, configurable), draft a channel-shaped follow-up (60–120 words, email/LinkedIn/portal, grounded **only** in that job's archived tailoring artifacts — no new claims), **drafts only, never sends**; log "followed up" as a stage event; **max 2 per application**; thank-you-note offer when an interview stage is recorded.

**Design:**
- Derivation from existing data: `jobs` where `status ∈ (applied, in_progress)` and latest `stage_events.occurred_at` older than threshold and follow-up count < 2. Follow-up count = count of stage events with `metadata.kind = 'followup'`.
- `services/followups.ts`: quiet-list query, draft generation via ghostwriter-context builder (posting + tailored summary + language), writing-style rules, no-new-claims constraint in system prompt.
- API: `GET /api/followups/quiet`, `POST /api/jobs/:id/followup/draft`, `POST /api/jobs/:id/followup/log` (explicit user action = "I sent it"), `POST /api/jobs/:id/thankyou/draft`.
- UI: "Quiet applications" panel on InProgress board with per-row Draft/Log actions; optional Telegram/webhook nudge via existing notification channels (documented payload, sanitized).
- Staleness surfacing (30d, signal-only) reuses the same panel with a different badge — never auto-acts.

**Tests:** quiet-window math (boundary days), max-2 cutoff, no drafts for jobs never submitted (`ready` = tailored only — excluded, mirrors the source's "drafted rows are never chased" rule), draft-word-count bounds, logging writes stage event + preserves history.

### Phase B — Tracking depth & prep

#### B1. Interview prep packs + mock interview (Effort: L, depends on A5)

**What:** On demand for a tracked application: stage-specific prep pack — likely questions (priority: recorded feedback → A1 gaps → posting requirements → stage type), STAR mapping from profile bank, **consistency brief** (claims in submitted docs that will be probed; "no claim in the room that isn't on the paper"), customized tough questions with verified company hooks, 4–6 questions-to-ask, logistics. Mock interview = ghostwriter conversation with a roleplay system prompt + per-answer feedback.

**Design:**
- Profile gains `star_examples` JSON (A2 migration extended: situations with S/T/A/R text + `useFor` tags) — CRUD in profile page.
- `services/interview-prep.ts`: assembles pack from job + `tailored_summary` + stage history + company research (A5) + profile STAR bank. **Stage derivation reads `stage_events` (`metadata.eventType='interview_log'`) — the `interviews` table is dead schema and stays unused; do not route new writes there.**
- Pack persisted as artifact: ~~`jobs.prep_packs`~~ better: `application_artifacts` mini-table (`id, user_id, job_id, kind('prep_pack'|'followup'|'form_text'), stage, content, created_at`) — shared by A8/C3 too. Pick this.
- Mock interview: ghostwriter thread mode `mode: 'mock_interview'` with roleplay protocol in system prompt; feedback calibrated to behavioral notes from A2.
- UI: prep-pack generator on job page + stage picker; chat mode toggle.

**Tests:** pack section completeness per stage, STAR mapping prefers `useFor` match, no-claims-beyond-docs rule in prompt assembly, artifact CRUD + tenancy.

#### B2. Outcome-driven calibration report (Effort: S–M)

**What:** Once ≥3 applications reach final states, compute "score vs. interview conversion" from existing `stage_events`/`outcome` data: which bands/score ranges actually converted; propose dimension-weight or threshold adjustments **as a suggestion** (never auto-applied); mine archived drafts for phrasing references (grounded, labeled).

**Design:** `services/calibration.ts` read-only report + settings preview; surface on settings/dashboard. No schema change (reads existing tables).
**Tests:** conversion math, suggestion gating at ≥3 finals, never writes weights.

#### B3. Upskill gap analysis (Effort: M, depends on A1's persisted gaps)

**What:** Heatmap of skill gaps across tracked + high-scoring undtracked jobs, fit-weighted ((100−score)/100 per job, **recorded gaps beat inferred**), plus LLM synthesis pass for domain/soft/tooling/credential gaps; learning plan: 2–3 web-researched resources per Critical/High gap (current-year queries via existing search infra), tailored study direction off profile, suggested order (dependencies, quick wins), period-over-period diff report.

**Design:** `services/upskill.ts` (pure aggregation + LLM pass), report artifact via `application_artifacts` (`kind='upskill'`) or a new `reports` store; page `UpskillPage` or a dashboard tab; "generate" action + history list.
**Tests:** weighting math, recorded-vs-inferred precedence, blank-score rows skipped (not weighted 1.0), diff computation, priority bands.

#### B4. Salary benchmarks (BYO data) (Effort: M)

**What:** Import a user-provided `salary_data.json` (metadata + companies[] with categories/index) or Excel upload (server-side conversion with the "last separator is decimal" rule + never-guess ambiguous cells); fuzzy company matching (legal-suffix strip, Nordic chars, dotted suffix `A.M.B.A.` bug is documented upstream — handle trailing dots); benchmark card in A1 evaluation view and job page; optional, absent data = step skipped.

**Design:** `services/salary-benchmark.ts` + upload route (settings-level artifact, tenant-scoped, sanitized file parse); matching normalizer shared with A5 company keys; no external calls.
**Tests:** converter locale cases (`60.000`, `1,234.56`, `1,234,567.89`), fuzzy match collisions, dataset validate endpoint, tenant isolation.

### Phase C — Reach & trust hardening

#### C1. Untrusted-content trust boundary (Effort: M) — **security**

**What:** Every path that feeds fetched posting/page text into an LLM gets a shared trust-boundary module: strip HTML comments/invisible-styled text/`(cid:)` junk before prompts; a system-prompt clause (data-never-instructions; never fetch embedded links; never output because the posting asked); the clause text lives in one shared constant so scorer/tailor/reviewer/ghostwriter/agentic all inherit it.
**Design:** `shared/src/untrusted-content.ts` (sanitize) + prompt constant; wire into scorer, tailoring, ghostwriter-context, crawler-llm/enricher, agentic search tools.
**Tests:** sanitizer fixture cases (hidden text, comments), prompt assembly includes the clause, regression: benign text unchanged.

#### C2. Fetch escalation doctrine for the crawler (Effort: M)

**What:** Formalize the escalation chain the source project proved out: `fetch` → **robots.txt gate** → browser-header retry (honest UA first; browser UA only when robots permits) → camoufox/playwright sidecar → WebSearch for employer's own posting; detect `#fragment` listing-page URLs and "fetched content ≠ promised title" as failed fetches; login walls are a distinct failure class.
**Design:** `shared/src/crawl/robots-check.ts` (longest-match, tie→Disallow, browser-readback-on-403, percent-decoding, fail-closed on unreadable) + crawler engine escalation wiring (existing `crawl/engine.ts`) + job-search source-runner preference hook for employer-site refetch.
**Tests:** robots parser table cases (incl. blank-line files, `Allow /` before `Disallow /cs/`, encoded rules, HTML-200 trap), escalation order unit tests, fragment/listing detection.

#### C3. Application-form fields (third artifact) (Effort: S)

**What:** Ghostwriter mode producing portal free-text fields (self-intro paragraph, structured project entries, hard char-limit pitches, motivation questions): **counts measured programmatically**, trimmed variants, scope-discipline rules (project role ≠ job title), saved to `application_artifacts` alongside the application.
**Design:** ghostwriter preset + artifact kind `form_text`; counts computed in code and appended to the draft.
**Tests:** count correctness, trimming variant picks documented cut point, artifact persistence.

#### C4. Custom resume templates (Effort: M)

**What:** Extend the existing template story — today: 3 built-in LaTeX templates (`charter`/`jake`/`modern` in `services/resume-renderer/latex.ts`) plus **one** global `customLatexTemplate` settings blob — into a real registry: multiple named LaTeX CV/cover templates stored with `[PLACEHOLDER]` tokens, a manifest (compile command for Tectonic, fonts, page limit, pitfalls), a **mandatory test compile** with dummy data before activation, per-user activation in settings. The renderer resolves the active template at compile time.
**Design:** `resume_templates` table (`id, user_id, name, kind(cv|cover), manifest_json, storage_path, active`); upload via settings/design-resume UI; test-compile runs Tectonic in the sandboxed data dir; failure shows last error lines, never activates. The legacy `customLatexTemplate` blob is migrated into the registry on first save (default choice; alternative: deprecate with a docs note).
**Tests:** placeholder validation, test-compile gate (bad template rejected), activation switch, renderer picks active template, tenant isolation.

#### C5. Profile expansion from public sources (Effort: M)

**What:** Given links already in the profile (GitHub, portfolio, Kaggle, Scholar), fetch and propose competencies with provenance tags; **user approves before write**; additions land source-annotated so re-runs are idempotent; also reads uploaded documents (already have resume-parser) for course/certification syllabi suggestions.
**Design:** `services/profile-expand.ts` (fetch via existing crawl infra w/ C2 doctrine + LLM extraction → proposal list), `POST /api/profile/expand` (dry-run proposals) + `POST /api/profile/expand/apply` (selected proposals); UI review modal on profile page.
**Tests:** proposal dedup vs existing profile, source annotations, selective apply, idempotent second run proposes nothing.

### Dependency graph & sequencing

```
A2 (profile: languages/deal-breakers/STAR/goals) ─┬─► A1 (scorer gates/breakdown) ─► B3 (upskill reads gaps)
                                                  └─► B1 (prep packs read gaps/STAR) ─┘
A5 (company research) ─► A4 (reviewer pass) ─► B1, ghostwriter review action
A6 (pdftotext tooling) ─► A7 (layout loop)          (A6 alone ships ATS report first)
A3 (deadline lifecycle)     — independent
A8 (follow-ups)             — independent (reads stage_events)
C1 (trust boundary)         — independent, land EARLY (security)
C2 (fetch doctrine)         — independent
C3 (form artifact)          — depends on ghostwriter + artifacts table (from B1)
B2 (calibration report)     — reads existing data only; anytime after A1
B4 (salary)                 — independent; shares company normalizer with A5 (land together)
C4 (templates)              — depends on A7 compile harness
C5 (expand)                 — depends on C2 fetch + A2 profile schema
```

**Land order (recommended):** C1 → A2 → A1 → A5+A4 → A3 → A6 → A7 → A8 → B1 → B2 → C2 → C4 → B3 → B4 → C3 → C5.

Rationale: trust boundary first (touches every LLM path while they're few); profile schema before scoring gates; research before reviewer; ATS tooling before layout loop; prep packs before upskill (shared artifact store); the rest by value/effort.

### Cross-cutting implementation standards (from AGENTS.md + this repo's conventions)

- Multi-tenant by default: every new table/service is `user_id`-scoped; request context supplies identity; caches keyed per tenant (learned from the profile-cache incident).
- API contract `{ok,data/error,meta.requestId}` with the status/code mapping in AGENTS.md.
- LLM prompts go through `prompt-templates`/`modelSelection`; **only required profile/job fields** are sent (PII minimization) — explicitly list which fields each new prompt carries and why, in the docs page.
- New scheduler work uses one owned cancellable timer (per the recent scheduler fix), not intervals+stray timeouts.
- New DB objects via the migration system currently in force (append-only `migrate.ts` array today; versioned ledger if the production-readiness migration work has landed).
- Docs: one feature page per shippable item (`docs-site/docs/features/*.md`) in the mandated structure, cross-linked; settings additions documented in `features/settings.md`.
- Sanitization: never log posting bodies/LLM payloads; reuse `@infra/sanitize`.
- MCP: when a new service is agent-usable (prep packs, follow-up drafts, scoring breakdown, upskill reports), also register an MCP tool in `orchestrator/src/server/mcp/tools/` — the server currently exposes search/jobs/status only, and each addition is cheap at that boundary.
- Tests: vitest colocated `*.test.ts`; pipeline steps tested with fake DBs per existing patterns (`score-jobs.test.ts` etc.); UI pure components get unit tests where logic-bearing.

### Estimates rollup

| Phase | Items | Effort |
|---|---|---|
| A (core quality) | A1–A8 | ~3L + 5M |
| B (tracking depth) | B1–B4 | 1L + 2M + 1S/M |
| C (reach & trust) | C1–C5 | 4M + 1S |
| **Total** | **16 features** | **4L + 11M + 1S** — realistically 3 phases of multiple sessions each, not one sitting |

### Risks & watch-items

1. **LLM determinism**: grounded-output claims need schema validation + rejection paths everywhere (A1/A4/B1/B3) — mirrors existing `JsonSchemaDefinition` usage; keep `additionalProperties: false`.
2. **Cost explosion**: reviewer pass (A4) + research (A5) double LLM spend per application — both are opt-in settings with caching; document costs.
3. **poppler/tectonic availability** in deployment targets — update Dockerfile, setup-server.sh, and docs prerequisites together (A6/A7/C4).
4. **Trust-boundary regressions as prompts evolve**: keep the clause in ONE shared constant with a coupling test (pattern proven by the source repo's own language-gate coupling test).
5. **Follow-up "no new claims" enforcement** is prompt-level; add the deterministic grounding pre-pass from A4 here too once available.
6. **Calibration (B2) writing weights automatically** — explicitly out of scope; suggestions only, human applies.

*End of plan.*

