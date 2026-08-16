# Senior Principal Engineer Audit Remediation Tracker

- [x] **Context & Multi-Tenancy**: Fix AsyncLocalStorage propagation in `job-search.ts`, `search orchestrator.ts`, and `agentic/orchestrator.ts` <!-- id: 0 -->
- [x] **Scoring & Ranking**: Fix 0-profile score inversion bug and remote location penalty in `ranking.ts` and `personalized-ranking.ts` <!-- id: 1 -->
- [x] **Location Support**: Normalize country without dropping valid markets in `query-parser.ts` <!-- id: 2 -->
- [x] **Extractor Resiliency**: Add safe parsing for `workplaceTypes` in `extractors/jobspy/manifest.ts` <!-- id: 3 -->
- [x] **Dedup Accuracy**: Sort query params in `normalizeUrl` and guard content keys in `dedup.ts` <!-- id: 4 -->
- [x] **Frontend Pagination**: Add client-side pagination on `JobSearchPage.tsx` <!-- id: 5 -->
- [x] **CI Parity Verification**: Run Biome, shared/orchestrator types, client build, and full test suite (215 files, 1371 tests passing) <!-- id: 6 -->
