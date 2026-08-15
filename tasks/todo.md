# Search Engine & MCP Implementation Tracker

- [x] **ADR**: Create architecture plan `adr/search-engine.md` <!-- id: 0 -->
- [x] **SE-005**: Raise candidate caps (2,000 / 300) & concurrency limits <!-- id: 1 -->
- [x] **SE-001**: Meta-search adapter framework & registry <!-- id: 2 -->
- [x] **SE-002**: DuckDuckGo Free Web Search & Public Aggregators (Jobicy, RemoteOK, Arbeitnow) <!-- id: 3 -->
- [x] **SE-004**: Source plan expansion & dynamic fallback <!-- id: 4 -->
- [x] **SE-018**: Fix accumulator cross-pipeline deduplication bug (`getAllJobUrls`) <!-- id: 5 -->
- [x] **SE-006 - SE-011**: Build Model Context Protocol (MCP) Server with stdio & SSE transports <!-- id: 6 -->
- [x] **SE-012**: Job import API (`POST /api/job-search/:id/import`) <!-- id: 7 -->
- [x] **SE-013 & SE-014**: UI Track buttons, Track All High Matches, and Tracked badges <!-- id: 8 -->
- [x] **SE-015**: Agentic search auto-persist highly matched jobs to `jobs` table <!-- id: 9 -->
- [x] **SE-016**: O(n) indexed deduplication (`DedupIndex`) <!-- id: 10 -->
- [x] **SE-017**: Cross-search dedup fingerprints table and repository <!-- id: 11 -->
- [x] **Settings UI**: Added Search & MCP settings section to Settings tab <!-- id: 12 -->
- [x] **Verification**: Full CI suite parity (Biome, types, build, 214 test files / 1366 tests passed) <!-- id: 13 -->
- [x] **Git Push**: Changes committed and pushed to git <!-- id: 14 -->

## Review & Completed Deliverables
- Reverse-engineered ModelScope skill repository endpoints (`/api/v1/dolphin/skills`, `/api/v1/skills/{owner}/{name}/repo/files`, `/api/v1/skills/{owner}/{name}/repo/raw`).
- Cataloged and compared all 250+ ModelScope skills against existing local skills.
- Imported 14 missing high-value skills complete with all references, schemas, font assets, and execution scripts:
  1. `pptx-generator` (MiniMax / Anthropic PPTX generator)
  2. `xlsx` (Anthropic Excel & spreadsheet engine)
  3. `code-review` (PR review checklists & quality patterns)
  4. `prd` (GitHub Product Requirements Document generator)
  5. `0-ui-ux-pro-max` (UI/UX design intelligence & styles)
  6. `web-design-guidelines` (Vercel Labs interface & accessibility rules)
  7. `chrome-devtools` (DevTools browser debugging & profiling)
  8. `download-anything` (Digital asset extraction & downloader workflows)
  9. `copywriting` (High-conversion landing page copy & UX writing)
  10. `canvas-design` (Visual 2D art & infographic design)
  11. `ontology` (Typed knowledge graph & entity memory)
  12. `stock-analysis-skill` (Financial & technical market analytics)
  13. `MinerU-Document-Extractor` (Multi-format OCR doc parser)
  14. `uniapp` (Cross-platform mini-program & app development)
- Verified all 28 skills in `~/.gemini/config/skills` with 100% valid YAML frontmatter and file structure integrity.
