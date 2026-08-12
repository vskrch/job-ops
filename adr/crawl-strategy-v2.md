# ADR-004: Crawl Strategy v2 — Unified Hardening + Agentic Browser Automation

**Status:** Accepted
**Date:** 2026-08-11
**Decision Type:** Architecture / Crawl Infrastructure / Agentic Workflows
**Deciders:** Engineering team (ADR review)
**Scope:** `shared/src/crawl/`, `extractors/*`, `orchestrator/src/server/services/agentic/`, `docker-compose.yml`
**Target:** Crawl Engine v2 + Agentic Browser Worker (optional, feature-flagged)

**Related ADRs:**
- [Crawler Architecture](./crawler.md) — CLOSED (3-backend chain, Crawl4AI selected, Firecrawl/Browser Use/Scrapy rejected for transport layer)
- [ADR-003: Crawl Engine Hardening](./crawl-engine-hardening.md) — ACCEPTED (25 gaps, 4-phase hardening plan)
- [ADR-001: Agentic Integration V2](./agentic-integration-v2.md) — Proposed (agentic search orchestrator, `search_company_jobs` tool deferred to Phase 3)

---

## 1. Context

### 1.1 Current State

The project has two parallel concerns evaluated in separate ADRs:

**Concern A — Crawl Resilience:** The 3-backend escalation chain (`direct → crawl4ai → jina`) is implemented. ADR-003 identified 25 concrete gaps (dead circuit breaker, 2-year-old fingerprints, 11 extractors bypassing the engine, brittle regex parsers, no cache TTL, missing modern anti-bot patterns) and proposed a 4-phase hardening plan.

**Concern B — Crawling Tool Selection:** `crawler.md` evaluated Firecrawl, Browser Use, and Scrapy as potential transport-layer replacements for Crawl4AI. All three were rejected for the transport layer — correctly, because none solve the transport problem better than Crawl4AI's single-container stealth browser. However, `crawler.md` also noted: *"They could be used for board-specific interactive scrapers (separate ADR), not the shared engine."* (crawler.md:368)

### 1.2 The Gap

The project can discover and score jobs, but it cannot **act** on them. The agentic search orchestrator (`agentic/orchestrator.ts`) can reason about search quality and iterate, but it cannot:

- Log into gated job portals to extract user-specific data
- Navigate multi-step interactive job boards that Crawl4AI's render-and-return model cannot handle
- Fill and submit job application forms (ATS: Workday, Greenhouse, Lever, etc.)
- The `search_company_jobs` tool (ADR-001, Phase 3) remains unimplemented

Crawl4AI v0.7.3+ has shipped agentic crawlers (Graph Crawler, Question-Based Crawler, Agentic Crawler for multi-step operations — documented in `crawler.md:329-331`). These could potentially handle some interactive scraping use cases. However, they are designed for **content extraction from linked pages**, not for **form interaction** (click, type, select, submit). Crawl4AI's agentic crawlers navigate links and extract content; they do not fill forms, handle authentication flows, or interact with dynamic UI widgets. For form-filling and authenticated sessions, a different class of tool is needed.

### 1.3 Constraint

The existing system must remain reliable. No change may break the lights-on contract. Crawl4AI remains the transport-layer browser backend. Any new tool is additive, gated behind feature flags, and optional.

---

## 2. Re-Audit: Three Options Evaluated for Agentic Workflows

This re-audit evaluates Firecrawl, Browser Use, and Scrapy against a **different axis** than `crawler.md`. `crawler.md` asked: "Which tool replaces Crawl4AI as a transport backend?" This re-audit asks: "Which tool expands the project's capabilities beyond what Crawl4AI can do?"

### 2.1 Firecrawl (Self-Hosted AGPL)

**What it provides beyond Crawl4AI:**
- Native JSON Schema extraction (`/extract` endpoint) — could replace custom regex parsers with declarative schemas
- Site mapping (`/map`, `/crawl`) — built-in sitemap crawling and link discovery

**What it doesn't provide:**
- Anti-bot capability in self-hosted mode (Fire-engine is cloud-only — `crawler.md:358`)
- Interactive browser automation (no click, type, login, form fill)
- AGPL-3.0 license — viral, conflicts with the project's licensing

**Verdict:** Firecrawl is a refinement of the discovery layer, not a new capability. It could replace Crawl4AI for structured extraction but doesn't enable anything the project can't already do with Crawl4AI + the existing LLM job-parser. The AGPL license is a blocker. **Defer until Crawl4AI's extraction capabilities are proven insufficient.**

### 2.2 Browser Use (MIT, Agentic Browser Automation)

**What it provides beyond Crawl4AI:**
- **Interactive browser control:** An LLM-driven agent that can open pages, click elements, type text, fill forms, handle dropdowns, and navigate multi-step flows
- **Vision + DOM understanding:** Can interpret page structure and reason about interactions
- **Auth & session management:** Can log into portals, maintain sessions, and extract gated data

**What it enables that the project cannot currently do:**
- **Auth-gated job extraction:** Log into company portals to extract application statuses and saved jobs
- **Interactive scraping:** Extract jobs from boards requiring login or multi-step navigation
- **Assisted job applications:** Fill ATS forms with human review before submission (not fully autonomous in V1)
- **The `search_company_jobs` tool:** ADR-001's agentic integration plan lists this as "Phase 3 — not implemented"

**Important caveats (verified):**
- Browser Use is distributed as a **Python library** (`pip install browser-use`), not as a pre-built Docker image. Deployment requires building a custom Docker image with a FastAPI wrapper — estimated 300-500 lines, not trivial.
- Browser Use's anti-bot capability in self-hosted mode is limited. `crawler.md:315` notes its anti-bot features are "Cloud-only (proxies, captcha)." The open-source library uses Playwright-stealth patches which provide basic anti-detection (hiding `navigator.webdriver`) but do not match Crawl4AI's undetected-browser mode for bypassing Cloudflare/Akamai.
- Browser Use requires an LLM provider. It supports OpenAI, Anthropic, and Gemini. If the project uses a self-hosted LLM (Ollama, vLLM), compatibility must be verified.

**Integration path:**
- Build a custom Docker image with Browser Use + FastAPI exposing `POST /run` and `GET /health`
- Add to `docker-compose.yml` as an optional sidecar (not started by default)
- The agentic orchestrator gains a `run_browser_task` tool, gated behind `browserAgentEnabled` feature flag
- Existing `ghostwriter.ts` provides tailored resume content; `applicationTracking.ts` receives status updates

**Verdict:** Browser Use is the only option that enables interactive agentic workflows. However, it requires non-trivial integration work (custom Docker image, FastAPI wrapper, LLM provider configuration) and its anti-bot capability in self-hosted mode is limited. **Recommended for staged adoption: interactive scraping first, auto-apply only after proven reliability.**

### 2.3 Scrapy + LLM/Agent Layer

**What it provides:**
- Mature, high-throughput Python crawling framework with built-in pipelines, throttling, and middleware

**Why it's not a fit:**
- **Language mismatch:** The project is TypeScript/Node.js. Adding a Python crawling framework fractures the architecture.
- **Redundant with `shared/src/crawl`:** The existing engine already provides throttling, retry, dedup, and structured extraction — in TypeScript, with the project's schema, and with the LLM job-parser already integrated.
- **No agentic capability:** Scrapy is designed for deterministic scraping pipelines, not dynamic LLM-driven site exploration or interactive browser automation.
- **High engineering overhead:** Rebuilding 20+ extractors in Python duplicates work already done.

**Verdict:** Not recommended. High friction, redundant with existing infrastructure, and brings no agentic advantage.

### 2.4 Comparative Synthesis

| Dimension | Firecrawl (Self-Hosted) | Browser Use | Scrapy + LLM |
|---|---|---|---|
| **Primary Role** | LLM-ready scraper / context API | Interactive web agent | High-throughput spider engine |
| **Overlap with existing** | Alternative to Crawl4AI | **New capability** (interactive, auth, forms) | Redundant with `shared/src/crawl` |
| **Interactive (auth/forms/click)** | None | Yes (vision + DOM control) | Manual coding per site |
| **License** | AGPL-3.0 (blocker) | MIT | BSD |
| **Deployment model** | Docker (complex stack) | Python library (requires custom wrapper) | Python framework |
| **Anti-bot (self-hosted)** | None (Fire-engine cloud-only) | Limited (Playwright stealth only) | None |
| **Enables auto-apply** | No | Yes (with human review) | No |
| **Enables auth-gated scraping** | No | Yes | With custom code |
| **Integration effort** | Low (REST API) | Medium-High (custom Docker + wrapper) | High (architectural split) |
| **ROI for job-ops** | Medium | High (if integration succeeds) | Low |

### 2.5 Genuine Challenges (Not Resolved)

These are challenges that do not have easy answers and represent real risk:

1. **Browser Use is a library, not a service.** Building a production-grade wrapper (task queue, session management, error handling, health checks, browser lifecycle) is 300-500 lines, not 50. This is the primary integration risk.

2. **Anti-bot capability is limited in self-hosted mode.** If a job board uses Cloudflare or Akamai, Browser Use's Playwright-stealth patches may not be sufficient. Crawl4AI's undetected-browser mode is more capable for anti-bot. Browser Use should be used for interactive workflows on sites that don't aggressively block, not as a general-purpose crawler.

3. **ATS form complexity is high.** Workday applications are multi-page forms with dynamic validation, file uploads, and custom widgets. A general-purpose LLM agent may not reliably navigate these without per-site customization. V1 should target simpler ATS platforms (Greenhouse, Lever) and accept that Workday may require manual fallback.

4. **Credential management is unsolved.** If Browser Use logs into third-party portals, user credentials must be stored, encrypted, and passed to the container. This requires a credential storage solution that doesn't exist today.

5. **Terms of Service risk.** Automated access to LinkedIn, Indeed, and company ATS platforms may violate their ToS. Users should be informed of this risk. The feature should be opt-in with a clear disclaimer.

6. **Testing is difficult.** Browser automation cannot be meaningfully tested in CI without real credentials and real target sites. A sandbox test environment (e.g., a local Greenhouse demo instance) would be needed for integration testing.

---

## 3. Decision

Adopt a **two-track strategy** that addresses both crawl resilience and agentic capability:

### Track A — Crawl Engine Hardening (ADR-003, already accepted)

Execute the 4-phase hardening plan from ADR-003. Crawl4AI remains the transport-layer browser backend. No replacement.

### Track B — Agentic Browser Automation (this ADR, staged adoption)

Add Browser Use as an **optional, feature-flagged** capability for interactive agentic workflows. Adoption is staged to manage risk:

**Stage B1 — Interactive Scraping (lower risk, higher confidence):**
- Build the Browser Use Docker image + FastAPI wrapper
- Add `run_browser_task` tool to the agentic orchestrator (gated behind `browserAgentEnabled`)
- Use for auth-gated job extraction and interactive scraping only
- No form submission; read-only operations
- Budget: 5 LLM calls, 30s timeout, ~$0.05 estimated cost per task

**Stage B2 — Assisted Applications (higher risk, requires B1 success):**
- Add form-filling capability with human review before submission
- Target simpler ATS platforms first (Greenhouse, Lever)
- Screenshot capture for user review; user must explicitly approve before submit
- Budget: 10 LLM calls, 60s timeout, ~$0.10 estimated cost per application
- Gated behind `browserAutoApplyEnabled` (separate from `browserAgentEnabled`)

**Stage B3 — Expanded ATS Support (requires B2 success):**
- Add Workday and custom ATS support based on learnings from B2
- Per-site customization as needed (not purely general-purpose)

### What we are NOT doing

- **NOT replacing Crawl4AI.** It remains the transport-layer browser backend.
- **NOT adding Firecrawl.** AGPL license is a blocker; Crawl4AI + LLM job-parser covers structured extraction.
- **NOT adding Scrapy.** Redundant with `shared/src/crawl`; Python-only; no agentic capability.
- **NOT enabling fully autonomous applications.** Human review required before any form submission.
- **NOT changing the lights-on contract.** All existing extractors continue to work. Browser Use is additive and optional.
- **NOT assuming Browser Use can bypass all anti-bot systems.** It is for interactive workflows on cooperative sites, not for anti-bot escalation (that's Crawl4AI's job).

---

## 4. Implementation Sequence

| Order | Item | Track | Effort | Dependencies |
|-------|------|-------|--------|-------------|
| 1 | ADR-003 Phase 1 (engine core hardening) | A | 3-5 days | None |
| 2 | ADR-003 Phase 2 (fingerprints) | A | 1-2 days | None (parallel with 1) |
| 3 | Browser Use Docker image + FastAPI wrapper | B1 | 3-5 days | None |
| 4 | `run_browser_task` tool + feature flag | B1 | 2-3 days | 3 |
| 5 | ADR-003 Phase 3 (extractor consolidation) | A | 5-8 days | 1, 2 |
| 6 | Interactive scraping prototype (auth-gated boards) | B1 | 3-5 days | 4, 5 |
| 7 | ADR-003 Phase 4 (orchestrator resilience) | A | 2-4 days | 5 |
| 8 | Assisted application prototype (Greenhouse/Lever) | B2 | 5-8 days | 6 |
| 9 | Credential storage solution | B2 | 2-3 days | 8 |
| 10 | Human review UI for application approval | B2 | 3-5 days | 8 |

Tracks A and B1 are independent and can start in parallel. B2 depends on B1 success. B3 is deferred until B2 is proven.

---

## 5. Deployment Model

### Browser Use Sidecar (docker-compose.yml addition)

```yaml
  # Browser Use — interactive browser automation for agentic workflows (optional)
  # Requires building the custom image first: docker build -t jobops-browser-use ./browser-use/
  browser-use:
    image: jobops-browser-use:latest
    build:
      context: ./browser-use
      dockerfile: Dockerfile
    container_name: browser-use
    ports:
      - "8000:8000"
    environment:
      - BROWSER_USE_LLM_API_KEY=${LLM_API_KEY}
      - BROWSER_USE_LLM_BASE_URL=${LLM_BASE_URL:-https://api.openai.com/v1}
      - BROWSER_USE_LLM_MODEL=${BROWSER_USE_LLM_MODEL:-gpt-4o-mini}
    shm_size: 2g
    restart: unless-stopped
    profiles:
      - browser-use  # Not started by default; use: docker compose --profile browser-use up
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### FastAPI Wrapper (browser-use/main.py — ~300 lines)

The wrapper exposes:
- `POST /run` — Execute a browser task: `{ "task": "string", "url?": "string", "maxSteps?": 10 }` → `{ "success": bool, "result": object, "screenshots?": [string], "steps": int, "error?": string }`
- `GET /health` — Health check
- `GET /sessions` — List active browser sessions
- `DELETE /sessions/{id}` — Close a session

The wrapper manages:
- A task queue (max 1 concurrent by default)
- Browser session lifecycle (create, reuse, close)
- LLM provider configuration from environment variables
- Timeout enforcement (configurable per task)
- Error handling and structured error responses

### Feature Flags (settings table)

| Flag | Default | Description |
|------|---------|-------------|
| `browserAgentEnabled` | `false` | Master toggle for Browser Use integration |
| `browserAutoApplyEnabled` | `false` | Enable assisted job applications (requires `browserAgentEnabled`) |
| `browserAgentMaxSteps` | `10` | Max browser interaction steps per task |
| `browserAgentTimeoutMs` | `60000` | Timeout per browser task |
| `browserAgentMaxCost` | `0.10` | Max estimated LLM cost per task |

---

## 6. Security Considerations

### Credential Storage

If Browser Use is used for auth-gated scraping (Stage B1), user credentials for third-party portals must be stored. Options:

1. **Environment variables** (current pattern for RxResume, Adzuna, UKVisaJobs): `BROWSER_USE_PORTAL_USERNAME`, `BROWSER_USE_PORTAL_PASSWORD`. Simple but not scalable for multiple portals.
2. **Settings table** (encrypted at rest): Store per-portal credentials in the `settings` table with encryption. Requires a `CREDENTIAL_ENCRYPTION_KEY` env var.
3. **No persistent storage** (V1 recommendation): Require credentials to be passed per-task via the API. The Browser Use container does not persist them. This is the safest option for V1.

**Decision:** Option 3 for V1. Credentials are passed in the task request, used for the session, and discarded when the session ends. No persistent credential storage until a proper secrets manager is in place.

### PII and LLM Providers

Job application forms contain PII (name, address, phone, work history). This data flows through Browser Use's LLM provider when the agent reasons about form fields. Mitigations:

1. **Use the same LLM provider as the project** (already configured with `LLM_API_KEY`). No new data processor.
2. **Document the data flow** in the feature's user-facing documentation: "When using assisted applications, your resume data is sent to your configured LLM provider for form-filling decisions."
3. **Offer a local-only mode** (future): If the project supports Ollama/vLLM, Browser Use can use the same local LLM, keeping all data on-premises.

### Terms of Service

Automated access to third-party platforms may violate their Terms of Service. Mitigations:

1. **Opt-in only.** Both `browserAgentEnabled` and `browserAutoApplyEnabled` default to `false`.
2. **Disclaimer in UI.** When enabling, show: "Automated browser interactions may violate the Terms of Service of third-party job platforms. Use at your own risk."
3. **Respect robots.txt.** The Browser Use wrapper should check `robots.txt` before accessing a domain (configurable).

### IP Correlation Risk

Crawl4AI and Browser Use share the same outbound IP. If a site blocks Browser Use, it may also block Crawl4AI. Mitigation:

1. **Separate browser profiles.** Crawl4AI and Browser Use use different Chromium instances with different fingerprints.
2. **Different traffic patterns.** Crawl4AI does rapid page fetches; Browser Use does slow, human-like interactions. These are distinguishable to anti-bot systems.
3. **Monitor for cross-service blocks.** If Crawl4AI success rates drop after Browser Use is enabled, investigate IP correlation.

---

## 7. Rollback Strategy

Browser Use is additive and optional. To disable it:

1. Set `browserAgentEnabled` to `false` in settings — the `run_browser_task` tool returns "Browser agent is disabled" without calling the sidecar.
2. Stop the Browser Use container: `docker compose --profile browser-use stop browser-use`.
3. The agentic orchestrator continues to function with all other tools. No data loss, no degraded functionality.

If Browser Use causes problems that require code removal:
1. The `run_browser_task` tool is registered conditionally based on the feature flag. Removing the tool registration (one file) disables it entirely.
2. The Browser Use Docker image and wrapper are in a separate directory (`browser-use/`). Deleting the directory removes all Browser Use code.
3. The docker-compose addition uses a `profiles` key, so it doesn't affect the default `docker compose up`.

---

## 8. Failure Modes

| Failure | Detection | Response |
|---------|-----------|----------|
| Browser Use container unreachable | Health check fails; `run_browser_task` returns error | Agentic orchestrator skips browser tasks; other tools continue |
| Browser Use task hangs | Task timeout (configurable, default 60s) | Task cancelled; browser session closed; error returned to orchestrator |
| LLM provider unavailable | Browser Use returns error from LLM call | Task fails; orchestrator logs warning; no retry (LLM failures are not transient) |
| ATS form structure changes mid-task | Browser Use agent fails to find expected elements | Task returns partial result with error; human review catches incomplete forms |
| Browser Use container crashes | Docker healthcheck detects; restart policy applies | In-flight task lost; new tasks queued after restart |
| Rate limited by target site | HTTP 429 from target | Browser Use wrapper detects 429; returns error with retry-after; orchestrator backs off |

---

## 9. Verification Plan

### Automated tests

```bash
# Track A (ADR-003 verification)
npm --workspace orchestrator run test:run

# Track B (new tests)
# Unit: browser-use client (mocked HTTP responses)
# Unit: run_browser_task tool (mocked Browser Use responses)
# Unit: feature flag gating (disabled → tool returns "disabled" error)
# Integration: FastAPI wrapper health check + basic task execution (requires Browser Use container)
npm --workspace orchestrator run test:run
```

### CI-parity checks

```bash
./orchestrator/node_modules/.bin/biome ci .
npm run check:types:shared
npm --workspace orchestrator run check:types
npm --workspace orchestrator run build:client
npm --workspace orchestrator run test:run
```

### Manual verification

**Track A:**
- Run `docker compose up crawl4ai`, trigger a jobboards crawl, verify circuit breaker trips after N consecutive blocks
- Verify SPA retry bypasses cache (pass `cache: false`)
- Verify Crawl4AI retries once before escalating to Jina

**Track B (Stage B1):**
- Build and start the Browser Use container: `docker compose --profile browser-use up -d`
- Verify health check: `curl http://localhost:8000/health`
- Run a test task: `curl -X POST http://localhost:8000/run -H "Content-Type: application/json" -d '{"task": "Go to example.com and return the page title", "maxSteps": 3}'`
- Verify the agentic orchestrator's `run_browser_task` tool works end-to-end

**Track B (Stage B2):**
- Set up a Greenhouse demo board (publicly available at `https://boards.greenhouse.io/` — use a test company's public board)
- Run an assisted application task: navigate to a job listing, click "Apply", fill the form with test data, capture a screenshot
- Verify the human review step: screenshot is displayed, user can approve or reject
- Verify the form is NOT submitted without explicit user approval

---

## 10. Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Browser Use integration is more complex than estimated | High | Staged adoption (B1 first); timebox B1 to 5 days; if not working, pause and reassess |
| Browser Use anti-bot is insufficient for target sites | High | Use only for cooperative sites; Crawl4AI handles anti-bot; document which sites work |
| ATS forms are too complex for general-purpose agent | High | Start with Greenhouse/Lever (simpler); accept Workday may need manual fallback; per-site customization in B3 |
| Credential leakage from Browser Use container | High | No persistent credential storage in V1; pass per-task; document security model |
| ToS violation → user account bans | Medium | Opt-in with disclaimer; respect robots.txt; human-in-loop for submissions |
| PII sent to LLM provider | Medium | Use same provider as project; document data flow; local-only mode in future |
| Crawl4AI + Browser Use IP correlation → both blocked | Medium | Separate browser profiles; different traffic patterns; monitor for cross-service blocks |
| Browser Use upstream abandoned or API changes | Medium | Pin version in Dockerfile; thin wrapper isolates from API changes; feature flag allows disabling |
| LLM cost overrun on complex pages | Low | Per-task budget ($0.10); max steps limit; timeout enforcement |
| Browser Use container resource contention with Crawl4AI | Low | Separate containers; Browser Use uses `profiles` (not started by default); resource limits in docker-compose |

---

## 11. Consequences

### Positive

- **New capability:** Interactive browser automation enables auth-gated scraping and assisted applications — capabilities the project cannot currently provide.
- **Completes the agentic vision:** ADR-001's `search_company_jobs` tool becomes implementable. The agentic orchestrator can now act, not just reason.
- **MIT license:** No license conflict. Can be used alongside Apache 2.0 (Crawl4AI) and the project's own licensing.
- **Staged adoption:** Low-risk entry via interactive scraping (B1); auto-apply only after proven reliability (B2).

### Negative

- **Operational complexity:** New container, new Python dependency, new Docker image to build and maintain.
- **Integration effort:** 300-500 line FastAPI wrapper, not trivial. Browser Use is a library, not a service.
- **Limited anti-bot:** Self-hosted Browser Use cannot match Crawl4AI's undetected-browser mode for anti-bot. It's for cooperative sites, not aggressive ones.
- **Testing difficulty:** Browser automation is hard to test in CI. Requires manual verification or a sandbox environment.
- **ToS risk:** Automated access to third-party platforms may violate their terms. Users must opt in with informed consent.

---

## 12. Decision — ACCEPTED

The re-audit confirms:

1. **`crawler.md` was correct** to reject Firecrawl, Browser Use, and Scrapy as transport-layer replacements. Crawl4AI remains the right choice for the 3-backend escalation chain.

2. **ADR-003 is correct** to identify 25 concrete gaps in the crawl infrastructure. The 4-phase hardening plan is the right approach to fix them.

3. **Browser Use is the right tool for interactive agentic workflows** — not as a transport replacement, but as an additive capability for auth-gated scraping and assisted applications. However, it requires non-trivial integration work (custom Docker image, FastAPI wrapper) and has limited anti-bot capability in self-hosted mode.

4. **Staged adoption is required.** Start with interactive scraping (B1, lower risk). Only proceed to assisted applications (B2) after B1 is proven reliable. Workday and custom ATS support (B3) is deferred.

5. **Firecrawl is deferred** until Crawl4AI's extraction capabilities are proven insufficient. The AGPL license is a blocker.

6. **Scrapy is rejected.** Redundant with existing infrastructure; no agentic advantage.

**The two-track strategy (harden what exists + staged agentic browser automation) is the optimal path forward.**

**Status:** Accepted
**Date:** 2026-08-11
