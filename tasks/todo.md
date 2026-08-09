# Pipeline Sources Validation Fix Plan

- [ ] Update `updateScheduleSchema` and `runPipelineSchema` in `orchestrator/src/server/api/routes/pipeline.ts` to allow empty array `sources: []`.
- [ ] Update `SchedulePipelineCard.tsx` payload handling.
- [ ] Add unit tests in `pipeline.test.ts` for empty `sources: []` payload in schedule update and pipeline run.
- [ ] Run full CI-parity verification suite.
- [ ] Document review & update `tasks/lessons.md`.
