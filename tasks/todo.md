# Heroku Deployment Audit & Fixes

## Phase 1: Deep Audit & Fixes
- [ ] Fix `Dockerfile.heroku`:
  - Add missing `docs-site/package*.json` copy step to ensure `npm ci` succeeds.
  - Inherit `runtime-node-deps` stage from `build-base` (so `build-essential` is present for native module builds like `better-sqlite3`).
  - Optimize multi-stage docker caching and asset copying.
- [ ] Fix `orchestrator/src/server/index.ts`:
  - Bind Express server explicitly to host `"0.0.0.0"` and `Number(PORT)` for Heroku compatibility.
  - Add graceful `SIGTERM` and `SIGINT` signal handlers for Heroku dyno restarts.
- [ ] Verify `heroku.yml` configuration:
  - Ensure correct build target (`Dockerfile.heroku`) and runtime command (`npx tsx src/server/db/migrate.ts && exec npm run start`).

## Phase 2: Verification
- [ ] Run full local CI parity checks:
  - `./orchestrator/node_modules/.bin/biome ci .`
  - `npm run check:types:shared`
  - `npm --workspace orchestrator run check:types`
  - `npm --workspace gradcracker-extractor run check:types`
  - `npm --workspace ukvisajobs-extractor run check:types`
  - `npm --workspace orchestrator run build:client`
  - `npm --workspace orchestrator run test:run`

## Phase 3: Deployment
- [ ] Build & push Docker container to Heroku Container Registry: `registry.heroku.com/job-ops-app/web`.
- [ ] Release container: `heroku container:release web --app job-ops-app`.
- [ ] Verify app startup and health check on Heroku: `heroku logs --tail --app job-ops-app` and test `/health` endpoint.
