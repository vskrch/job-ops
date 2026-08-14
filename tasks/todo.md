# Todo List

- [x] Add settings for LLM crawling and enrichment (`llmCrawlingEnabled`, `llmEnrichmentEnabled`, `llmMaxEnrichmentJobs`) in `settings-registry.ts` <!-- id: 0 -->
- [x] Upgrade `shared/src/llm/job-parser.ts` with deep structured job extraction & detail parsing <!-- id: 1 -->
- [x] Create `orchestrator/src/server/services/crawler-llm/enricher.ts` with search term synthesis, detail gathering, and relevance filtering <!-- id: 2 -->
- [x] Integrate LLM-powered crawling and information gathering into `discoverJobsStep` in `discover-jobs.ts` <!-- id: 3 -->
- [x] Write unit & integration tests for LLM crawling and information gathering <!-- id: 4 -->
- [x] Run full CI parity checks (Biome, TypeScript, tests, client build) and verify zero regressions <!-- id: 5 -->

## Review & Verification Summary
- Created `orchestrator/src/server/services/crawler-llm/enricher.ts` with:
  1. `synthesizeCrawlTermsWithLlm`: Profile & intent-driven query synthesis generating high-precision search keywords and negative exclusion terms.
  2. `enrichDiscoveredJobsWithLlm`: Automated detail page crawler & structured LLM information extractor for jobs with missing/short descriptions.
  3. `filterJobsByNegativeKeywords`: Rejection filter for non-technical or mismatched jobs (e.g. sales, marketing, intern).
- Integrated with `discoverJobsStep` in `orchestrator/src/server/pipeline/steps/discover-jobs.ts`.
- Registered `llmCrawlingEnabled`, `llmEnrichmentEnabled`, and `llmMaxEnrichmentJobs` in `shared/src/settings-registry.ts`.
- All 206 test suites (1,348 tests) passed. Biome CI, TypeScript noEmit, and Vite client build 100% green.
