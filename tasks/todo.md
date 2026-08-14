# Todo List

- [x] Add `charter` to `LATEX_TEMPLATE_VALUES` and update settings registry <!-- id: 0 -->
- [x] Create `templates/charter-resume.tex` matching the user's exact LaTeX template specification <!-- id: 1 -->
- [x] Update `latex.ts` to support Charter rendering, granular placeholder tags, and tectonic compilation <!-- id: 2 -->
- [x] Update UI settings in `ReactiveResumeConfigPanel.tsx` with Charter preset and custom template editor <!-- id: 3 -->
- [x] Write unit and integration tests in `latex.test.ts` to verify Charter rendering and PDF compilation with tectonic <!-- id: 4 -->
- [x] Run full CI parity checks and verify zero regressions <!-- id: 5 -->

## Review & Verification Summary
- **Charter LaTeX Template Preset**: Implemented [charter-resume.tex](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/server/services/resume-renderer/templates/charter-resume.tex) using Charter font, 10.5pt, compact margins (0.4in top/bottom, 0.5in left/right), titlesec rules, and itemize list spacing.
- **LaTeX Engine Enhancements**: Updated [latex.ts](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/server/services/resume-renderer/latex.ts) with template-specific semantic rendering (Charter skills, experience, education, projects, certifications), XeTeX / tectonic compatibility (`iftex`), and support for custom LaTeX templates with individual section tags (`__SKILLS__`, `__EXPERIENCE__`, `__EDUCATION__`, `__PROJECTS__`, `__SUMMARY__`) as well as `__BODY__`.
- **Settings & Defaults**: Set `charter` as the default `latexTemplate` in [settings-registry.ts](file:///Users/venkatasai/untitled%20folder/job-ops/shared/src/settings-registry.ts) and [settings.ts](file:///Users/venkatasai/untitled%20folder/job-ops/shared/src/types/settings.ts).
- **UI Settings**: Updated [ReactiveResumeConfigPanel.tsx](file:///Users/venkatasai/untitled%20folder/job-ops/orchestrator/src/client/components/ReactiveResumeConfigPanel.tsx) with the new Charter option and custom TeX editor with all placeholder documentation.
- **Verification**: All 205 test files (1,345 tests) passed, Biome CI passed (775 files), TypeScript checks passed across `shared` and `orchestrator`, and client build compiled cleanly.
