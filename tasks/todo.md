# Todo List

- [x] Upgrade `enricher.ts` with parallel `asyncPool` concurrency for ultra-fast multi-job enrichment <!-- id: 0 -->
- [x] Expand LLM enrichment schema with `techStack`, `seniorityLevel`, `visaStatus`, and `workArrangement` <!-- id: 1 -->
- [x] Add platform-specific query adaptation in `synthesizeCrawlTermsWithLlm` <!-- id: 2 -->
- [x] Implement self-healing LLM fallback parser in `careerbuilder/src/run.ts` when regex returns 0 matches <!-- id: 3 -->
- [x] Create high-yield zero-403 API extractors: `extractors/jobicy` and `extractors/arbeitnow` <!-- id: 4 -->
- [x] Register new sources in `shared/src/extractors/index.ts` and `demo-defaults.data.ts` <!-- id: 5 -->
- [x] Write unit & integration tests and run full CI parity checks (Biome, TypeScript, tests, client build) <!-- id: 6 -->

## Review & Verification Summary
- **High-Throughput Parallel Enrichment**: Concurrently enriches truncated jobs using `asyncPool` with concurrency 4.
- **Deep Semantic Schema**: Extracts `skills`, `seniorityLevel` (junior, mid, senior, lead, staff), `workArrangement` (remote, hybrid, onsite), `visaStatus` (sponsorship availability), and clean salary bounds.
- **Self-Healing LLM Extraction**: CareerBuilder and other DOM extractors now auto-heal with `llmParseJobs` whenever anti-bot or DOM changes yield 0 regex matches.
- **New High-Yield Zero-403 Extractors**:
  - `jobicy` (Jobicy Public JSON API)
  - `arbeitnow` (Arbeitnow Public JSON API)
- **CI Parity**: 208 test suites passed, 1,350 unit & integration tests passed. Biome CI, shared & orchestrator TypeScript, and client build 100% green.
