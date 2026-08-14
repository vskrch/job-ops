# Todo List

- [x] Create RFC 4180 compliant CSV export utility with UTF-8 BOM (`orchestrator/src/client/lib/csv-export.ts`) <!-- id: 0 -->
- [x] Add "Select all filtered" & "Export CSV" to `JobListPanel.tsx` <!-- id: 1 -->
- [x] Add "Export CSV" action to `FloatingJobActionsBar.tsx` when jobs are selected <!-- id: 2 -->
- [x] Integrate `exportSelectedJobs` and `exportFilteredJobs` into `useJobSelectionActions.tsx` and `OrchestratorPage.tsx` <!-- id: 3 -->
- [x] Add "Export CSV" button to `JobSearchPage.tsx` ranked results <!-- id: 4 -->
- [x] Add unit tests for CSV export and JobListPanel export actions (`csv-export.test.ts`, `JobListPanel.test.tsx`) <!-- id: 5 -->
- [x] Run full CI parity checks (Biome clean, TypeScript shared/orchestrator clean, Vite client build clean, 211 test files / 1,355 tests green) <!-- id: 6 -->

## Review & Verification Summary
- **Select All Filtered & Export to CSV**: Users can now select all filtered jobs with one click and export them directly to a formatted CSV spreadsheet with proper UTF-8 BOM, escaped multiline fields, and detailed match data.
- **Export from Multiple Contexts**: Supported from `JobListPanel` header ("Export CSV" for all filtered jobs), `FloatingJobActionsBar` ("Export CSV" for selected jobs), and `JobSearchPage` ("Export CSV" for ranked results).
- **CI Parity**: 211 test files passed, 1,355 tests passed with 0 failures across the repository.
