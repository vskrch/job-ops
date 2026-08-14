# Todo List

- [x] Deep research of global web job APIs, ATS endpoints, and feeds <!-- id: 0 -->
- [x] Dynamic & adaptive ATS board discovery (`extractors/ats/src/discovery.ts` and `manifest.ts`) without hardcoding barriers <!-- id: 1 -->
- [x] Implemented **The Muse API Extractor** (`extractors/themuse`) with dynamic category and query filtering <!-- id: 2 -->
- [x] Integrated `themuse` into shared source catalog, metadata, and health probe registry <!-- id: 3 -->
- [x] Added unit tests for dynamic ATS and The Muse extractors <!-- id: 4 -->
- [x] Ran full CI-parity checks (Biome clean, TypeScript shared/orchestrator clean, Vite client build clean, 210 test files / 1,352 tests green) <!-- id: 5 -->

## Review & Verification Summary
- **Dynamic & Adaptive ATS Engine**: Zero hardcoding required. Users do not need to manually configure company names; the ATS engine dynamically selects high-yield active boards and applies search-term and country filtering.
- **The Muse Live API**: 100,000+ curated engineering and tech roles dynamically queried and normalized into `CreateJobInput`.
- **CI Parity**: 210 test files passed, 1,352 tests passed across the repository.
