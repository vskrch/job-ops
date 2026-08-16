# True Multi-Tenancy Implementation Tracker

- [x] **Database Schema & Migrations**: Add `userId` to `pipeline_schedules`, `search_schedules`, `post_application_integrations`, `post_application_sync_runs`, `post_application_messages` in `schema.ts` and `migrate.ts` <!-- id: 0 -->
- [x] **Pipeline Schedules Multi-Tenancy**: Scope CRUD in `pipeline-schedules.ts` repo & scheduler execution in `pipeline-scheduler.ts` to `currentUserId()` <!-- id: 1 -->
- [x] **Search Schedules Multi-Tenancy**: Scope CRUD in `search-schedules.ts` repo & scheduler execution in `search-scheduler.ts` to `currentUserId()` <!-- id: 2 -->
- [x] **Design Resume Isolation**: Scope `designResumeDocuments` queries and upserts to `currentUserId()` in `design-resume.ts` repo <!-- id: 3 -->
- [x] **Post-Application Integrations Isolation**: Scope integrations, sync runs, and messages to `currentUserId()` <!-- id: 4 -->
- [x] **CI Parity & Multi-Tenant Tests**: Verify with full test suite, Biome, type checks, and client build <!-- id: 5 -->
