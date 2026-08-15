# Todo: Extract and Import Most Useful Skills from ModelScope

- [x] Fetch catalog of skills from ModelScope Skills Hub (`https://modelscope.cn/skills`) <!-- id: 0 -->
- [x] Analyze and filter out skills we already have (`apex`, `doc`, `pdf`, `playwright`, `security-*`, etc.) <!-- id: 1 -->
- [x] Select top high-utility, robust skills across missing domains (Office/Excel, PPTX, Code Review, PRD, UI/UX Pro Max, Web Design Guidelines, Chrome DevTools, Download Anything, Copywriting, Canvas Design, Ontology, MinerU, UniApp) <!-- id: 2 -->
- [x] Extract full skill packages (SKILL.md, references, scripts, examples) from ModelScope API for all selected skills <!-- id: 3 -->
- [x] Import and install skills into global Antigravity skills repository (`~/.gemini/config/skills/`) <!-- id: 4 -->
- [x] Validate and verify each imported skill structure, frontmatter YAML, and file integrity <!-- id: 5 -->
- [x] Update tasks/todo.md and provide detailed summary to user <!-- id: 6 -->

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
