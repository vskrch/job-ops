# LLM-Powered Crawl Engine + Crawl4AI Integration

## Background

The current engine ([engine.ts](file:///Users/venkatasai/untitled%20folder/job-ops/shared/src/crawl/engine.ts)) has two backends: `direct` (raw HTTP fetch) and `jina` (Jina Reader proxy). This works but both are fundamentally HTTP-only — they can't execute JavaScript, handle CAPTCHAs, or defeat fingerprint-aware anti-bot systems.

[Crawl4AI](https://github.com/unclecode/crawl4ai) is an open-source, self-hosted headless browser crawling service that runs as a Docker container exposing a REST API at `POST /crawl`. It provides:
- **Stealth mode** (`enable_stealth: true`) — removes `navigator.webdriver`, spoofs fingerprints
- **Full JS rendering** via managed Chromium browser pool
- **Clean markdown output** — exactly what our LLM parser consumes
- **Fit markdown** — BM25/pruning-based noise removal for LLM-friendly content
- **Session management** — persistent browser contexts across requests
- **Anti-detection escalation** — configurable proxy support

## Architecture: 3-Backend Escalation

```
direct HTTP → crawl4ai (browser-rendered, stealth) → jina (proxy fallback)
```

| Backend | How | When | Cost |
|---|---|---|---|
| `direct` | Raw `fetch()` with fingerprinted headers | Always first — cheap, fast | Free |
| `crawl4ai` | `POST` to self-hosted Crawl4AI Docker container | When direct gets blocked/CAPTCHA'd, or SPA needs JS render | Free (self-hosted) |
| `jina` | Jina Reader proxy `r.jina.ai` | Last resort when even browser crawl fails | Free tier / API key |

## Proposed Changes

### `shared/src/crawl/`

---

#### [NEW] [fingerprints.ts](file:///Users/venkatasai/untitled%20folder/job-ops/shared/src/crawl/fingerprints.ts) ✅ Already Created

~20 browser fingerprints (Chrome 124-126, Firefox 125-127, Safari 17.4-17.5, Edge 124-126) with matching `sec-ch-ua`, `sec-fetch-*`, `accept-language` headers. Already written.

---

#### [NEW] [block-detector.ts](file:///Users/venkatasai/untitled%20folder/job-ops/shared/src/crawl/block-detector.ts)

Heuristic-first CAPTCHA/block detection:
```ts
export type BlockSignal = "ok" | "blocked" | "captcha" | "uncertain";
export function detectBlock(args: { status: number; contentType: string; text: string }): BlockSignal
```

- Fast regex checks for known patterns: `cf-challenge`, `hCaptcha`, `recaptcha`, `Just a moment...`, `Access Denied`, `bot detected`, `Verify you are human`
- Checks for tiny HTML bodies (<500 chars) with no real content (common CAPTCHA shell)
- **No LLM call** — purely heuristic. The LLM integration already happens at the job-parsing layer; we don't want LLM cost at the transport layer.
- Returns `"blocked"` or `"captcha"` → engine escalates to next backend

---

#### [NEW] [crawl4ai-backend.ts](file:///Users/venkatasai/untitled%20folder/job-ops/shared/src/crawl/crawl4ai-backend.ts)

The Crawl4AI REST client:
```ts
export interface Crawl4AIConfig {
  /** Base URL of the self-hosted Crawl4AI server (e.g., "http://localhost:11235"). */
  baseUrl: string;
  /** Optional JWT token for authenticated Crawl4AI servers. */
  apiToken?: string;
  /** Enable stealth mode (default: true). */
  stealth?: boolean;
  /** Request timeout in ms (default: 30000). */
  timeoutMs?: number;
}

export interface Crawl4AIResult {
  ok: boolean;
  markdown: string;
  html: string;
  fitMarkdown?: string;
  statusCode: number;
  error?: string;
  metadata?: Record<string, unknown>;
}

export async function crawl4aiFetch(
  url: string,
  config: Crawl4AIConfig,
  signal?: AbortSignal,
): Promise<Crawl4AIResult>
```

Implementation:
- Sends `POST {baseUrl}/crawl` with:
  ```json
  {
    "urls": ["<target>"],
    "browser_config": {
      "type": "BrowserConfig",
      "params": {
        "headless": true,
        "enable_stealth": true
      }
    },
    "crawler_run_config": {
      "type": "CrawlerRunConfig",
      "params": {
        "wait_until": "networkidle",
        "word_count_threshold": 10,
        "bypass_cache": true
      }
    }
  }
  ```
- Handles both sync (immediate `results` in response) and async (`task_id` → poll `/task/{id}`) flows
- Returns normalized `Crawl4AIResult` with `markdown`, `html`, `fitMarkdown`
- Never throws — returns `ok: false` on failure

---

#### [NEW] [organic-headers.ts](file:///Users/venkatasai/untitled%20folder/job-ops/shared/src/crawl/organic-headers.ts)

Generates realistic `Referer` and `sec-fetch-*` headers per domain without LLM:
```ts
export function buildOrganicHeaders(
  url: string,
  fingerprint: BrowserFingerprint,
): Record<string, string>
```

- Derives domain from URL
- Generates a Google-like `Referer` (`https://www.google.com/`) for first-visit requests
- Sets `sec-fetch-site: cross-site` for initial navigation, `same-origin` for subsequent
- Adds `DNT: 1` randomly (~30% of requests, mimics privacy-conscious users)
- Purely deterministic — no LLM cost, no caching needed

---

#### [MODIFY] [engine.ts](file:///Users/venkatasai/untitled%20folder/job-ops/shared/src/crawl/engine.ts)

Major changes:
1. **New backend type**: `CrawlBackend = "direct" | "crawl4ai" | "jina"`
2. **Import fingerprints**: Replace 4 static UAs with `BROWSER_FINGERPRINTS` rotation via `nextFingerprint()`
3. **Import block detector**: After every response, run `detectBlock()` — if `blocked`/`captcha`, treat as retryable and escalate to next backend
4. **Crawl4AI backend handling**: When `backend === "crawl4ai"`, call `crawl4aiFetch()` instead of raw `fetchImpl`
5. **Behavior profiles**: Add `BehaviorProfile` type (`"fast" | "normal" | "cautious" | "stealth"`) with timing presets
6. **New options**: `crawl4ai?: Crawl4AIConfig` in `CrawlEngineOptions`, `behaviorProfile?: BehaviorProfile` in both options types
7. **Result extension**: Add `blockDetected?: boolean` to `CrawlRequestResult`

Behavior profile timing presets:

| Profile | `thinkTimeMs` | `throttleMs` | `longPauseChance` | `longPauseMs` |
|---|---|---|---|---|
| `fast` | 200-500 | 400-800 | 0% | — |
| `normal` | 800-1600 | 800-1600 | 5% | 3000-8000 |
| `cautious` | 1500-3000 | 1500-3000 | 10% | 5000-15000 |
| `stealth` | 2500-6000 | 3000-7000 | 20% | 8000-30000 |

---

### Integration in jobboards extractor

#### [MODIFY] [run.ts](file:///Users/venkatasai/untitled%20folder/job-ops/extractors/jobboards/src/run.ts)

- Default backend order becomes `["direct", "crawl4ai", "jina"]` when `CRAWL4AI_BASE_URL` is configured
- Pass `crawl4ai` config and `behaviorProfile` from options down to `CrawlEngine`
- SPA boards (Monster, Instahyre) that return empty shells via direct fetch now get browser-rendered content from Crawl4AI before falling to Jina

---

### Docker / Infrastructure

#### [MODIFY] [docker-compose.yml](file:///Users/venkatasai/untitled%20folder/job-ops/docker-compose.yml)

Add Crawl4AI as a sidecar service:
```yaml
crawl4ai:
  image: unclecode/crawl4ai:latest
  container_name: crawl4ai
  ports:
    - "11235:11235"
  shm_size: 1g
  environment:
    - CRAWL4AI_API_TOKEN=${CRAWL4AI_API_TOKEN:-}
  restart: unless-stopped
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:11235/health"]
    interval: 30s
    timeout: 10s
    retries: 3
```

#### [MODIFY] [.env.example](file:///Users/venkatasai/untitled%20folder/job-ops/.env.example)

Add:
```env
# Crawl4AI (headless browser crawling) - optional
# Self-hosted Crawl4AI server for JS rendering and stealth crawling
CRAWL4AI_BASE_URL=http://crawl4ai:11235
CRAWL4AI_API_TOKEN=
```

---

### Tests

#### [MODIFY] [engine.test.ts](file:///Users/venkatasai/untitled%20folder/job-ops/shared/src/crawl/engine.test.ts)

New test cases:
- Fingerprint rotation (all header fields rotate together)
- Block detection for known CAPTCHA patterns
- Backend escalation: `direct(blocked)` → `crawl4ai(ok)` → skips jina
- Backend escalation: `direct(blocked)` → `crawl4ai(blocked)` → `jina(ok)`
- `blockDetected` flag in result
- Behavior profile pacing (mock setTimeout)

#### [NEW] [block-detector.test.ts](file:///Users/venkatasai/untitled%20folder/job-ops/shared/src/crawl/block-detector.test.ts)

Test heuristic detection for:
- Cloudflare challenge page
- hCaptcha/reCAPTCHA pages
- "Access Denied" responses
- Normal HTML returns `"ok"`

#### [NEW] [crawl4ai-backend.test.ts](file:///Users/venkatasai/untitled%20folder/job-ops/shared/src/crawl/crawl4ai-backend.test.ts)

Test the REST client:
- Sync response (immediate results)
- Async response (task_id → poll)
- Network error → ok: false
- Timeout handling

---

## Verification Plan

### Automated Tests
```bash
npm --workspace orchestrator run test:run
```

### CI-parity checks
```bash
./orchestrator/node_modules/.bin/biome ci .
npm run check:types:shared
npm --workspace orchestrator run check:types
npm --workspace gradcracker-extractor run check:types
npm --workspace ukvisajobs-extractor run check:types
npm --workspace orchestrator run build:client
npm --workspace orchestrator run test:run
```

### Manual verification
- Run `docker compose up` with the new `crawl4ai` service
- Trigger a jobboards crawl for a known SPA board (Monster/Instahyre) and verify Crawl4AI backend is used
- Verify fallback chain works when Crawl4AI container is stopped
