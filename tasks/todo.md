# Expand Crawling Capabilities & Add https://hnhiring.com/

- [x] **Component 1: HNHiring Extractor Overhaul & https://hnhiring.com/ Integration**:
  - [x] Implement `https://hnhiring.com/` web scraper in `extractors/hnhiring/src/run.ts` (monthly index discovery + job card parsing)
  - [x] Rewrite Hacker News comment parser with robust multi-format delimiter matching (`|`, `-`, `—`, `•`, `/`, etc.) and field extraction (`employer`, `title`, `location`, `salary`, `applicationLink`, `isRemote`)
  - [x] Update `extractors/hnhiring/src/manifest.ts` with higher default limits (`maxJobsPerTerm: 200`)
  - [x] Update and expand `extractors/hnhiring/tests/run.test.ts`
- [x] **Component 2: Pipeline Discovery Enhancements**:
  - [x] Update `filterJobsByRequestedCities` in `orchestrator/src/server/pipeline/steps/discover-jobs.ts` to preserve remote jobs
  - [x] Update `synthesizeCrawlTermsWithLlm` in `orchestrator/src/server/services/crawler-llm/enricher.ts` to retain all user base search terms
- [x] **Component 3: Verification & CI Parity**:
  - [x] Run HNHiring tests (`extractors/hnhiring/tests/run.test.ts`)
  - [x] Run all 5 required CI-parity checks (Biome, TS shared, TS orchestrator, build:client, full test suite — 1384/1384 passed)
- [x] **Component 4: Deployment & Live Verification**:
  - [ ] Git commit and push to `upstream dev`
  - [ ] Deploy to DigitalOcean (`157.245.138.16`)
  - [ ] Live endpoint verification
