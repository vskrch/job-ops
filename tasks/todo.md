# JobOps Pipeline Audit & Fixes

## Audit & Bug Identification
- [x] Run full CI-parity checks to detect failures across format, types, client build, and tests.
- [x] Identify formatting failures in `orchestrator/data/visa-sponsors/*/metadata.json`.
- [x] Audit extractor country rules in `shared/src/location-support.ts` for newly added extractors (`usajobs`).

## Proposed Fixes
- [x] Fix formatting issues in `orchestrator/data/visa-sponsors/ca/metadata.json`, `orchestrator/data/visa-sponsors/uk/metadata.json`, and `orchestrator/data/visa-sponsors/us/metadata.json` so `./orchestrator/node_modules/.bin/biome ci .` passes cleanly.
- [x] Update `shared/src/location-support.ts` to include `usajobs` in `US_ONLY_SOURCES` so pipeline country filtering handles federal job queries properly.
- [x] Add unit test coverage in `shared/src/location-support.test.ts` for `usajobs` country scoping.

## Verification
- [x] Run full CI-parity checks:
  1. `./orchestrator/node_modules/.bin/biome ci .` (Passed - 669 files checked, 0 errors)
  2. `npm run check:types:shared` (Passed)
  3. `npm --workspace orchestrator run check:types` (Passed)
  4. `npm --workspace gradcracker-extractor run check:types` (Passed)
  5. `npm --workspace ukvisajobs-extractor run check:types` (Passed)
  6. `npm --workspace orchestrator run build:client` (Passed - Vite build successful)
  7. `npm --workspace orchestrator run test:run` (Passed - 181/181 test files passed, 1150 tests)

## Review
- **Formatting Fix**: Resolved EOF missing newline issues in all 3 sponsor metadata JSON files.
- **Extractor Scoping**: `usajobs` is now restricted to `united states` in `shared/src/location-support.ts` with test coverage in `shared/src/location-support.test.ts`.
- **CI Parity**: All 7 required CI checks are verified and passing cleanly.
