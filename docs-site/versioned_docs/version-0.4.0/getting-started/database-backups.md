---
id: database-backups
title: Database Backups
description: Configure, run, and restore JobOps database backups.
sidebar_position: 2
---

## What this covers

This page is about database backups:

- automatic backup schedule
- manual backup creation/deletion
- retention behavior
- restore workflow
- backup troubleshooting

## Backup behavior

JobOps stores backups in the same data directory as `jobs.db`.

Two backup types exist:

- **Automatic** backups
- **Manual** backups

### Automatic backups

- Scheduled daily.
- Filename format: `jobs_YYYY_MM_DD.db`
- Schedule hour is configured in Settings (**UTC hour**).
- Automatic retention is capped by `backupMaxCount`.
- If today’s automatic backup already exists, JobOps skips creating a duplicate.

### Manual backups

- Triggered from Settings or `POST /api/backups`.
- Filename format: `jobs_manual_YYYY_MM_DD_HH_MM_SS.db`
- If a filename collision occurs, JobOps appends `_1`, `_2`, etc.
- Manual backups are **not** auto-deleted by automatic retention cleanup.

## Configure backups

In **Settings → Backup**:

1. Enable automatic backups.
2. Set backup hour (`0-23`, UTC).
3. Set max automatic backups to keep (`1-5`).
4. Save settings.

## API reference

```bash
# List backups + next scheduled run time
curl "http://localhost:3001/api/backups"
```

```bash
# Create a manual backup
curl -X POST "http://localhost:3001/api/backups"
```

```bash
# Delete a specific backup
curl -X DELETE "http://localhost:3001/api/backups/jobs_manual_2026_02_15_10_20_30.db"
```

```bash
# Update backup settings via Settings API
curl -X PATCH "http://localhost:3001/api/settings" \
  -H "content-type: application/json" \
  -d '{
    "backupEnabled": true,
    "backupHour": 2,
    "backupMaxCount": 5
  }'
```

## Restore workflow

To restore from a backup:

1. Stop JobOps.
2. Locate backup files in your data directory.
3. Copy the chosen backup over the main DB file (`jobs.db`).
4. Start JobOps.
5. Verify jobs/runs in the UI.

Example shell flow:

```bash
# Example only: adjust paths for your setup
cp /path/to/data/jobs_manual_2026_02_15_10_20_30.db /path/to/data/jobs.db
```

## Off-site backups (S3 / Cloudflare R2)

Local backups live next to `jobs.db` — on platforms with an **ephemeral
filesystem** (notably Heroku containers), the data directory is recreated on
every boot and local backups disappear with it. Off-site backups mirror the
database to any **S3-compatible object store** so no deploy/restart can
destroy your data.

### What it does

- **Boot restore** — when `jobs.db` is missing (fresh filesystem), the latest
  remote snapshot is downloaded before migrations run.
- **Uploads** — a snapshot is uploaded after every successful local backup
  (automatic or manual), at server startup, and during graceful shutdown.
- **Retention** — remote backups older than `S3_RETENTION_DAYS` are pruned
  automatically (default: 14 days; `0` disables pruning).
- **Safety** — if a restore fails on boot, the server refuses to start with a
  fresh empty database rather than risk overwriting your only copy. The
  store is only used when `S3_*` variables are set.

### Setup (Cloudflare R2, free tier)

1. In Cloudflare Dashboard → **R2** → create a bucket (e.g. `jobops-backups`).
2. In **R2 → Manage API tokens** → create a token with **Object Read &
   Write** scoped to that bucket only. Copy the Access Key ID and Secret.
3. Find your account ID in the R2 overview page — the endpoint is
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
4. Set the environment variables (`.env` for self-hosting, `heroku config:set`
   on Heroku):

```bash
S3_ENDPOINT=https://<ACCOUNT_ID>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<access key id>
S3_SECRET_ACCESS_KEY=<secret>
S3_BUCKET=jobops-backups
S3_REGION=auto
S3_PREFIX=jobops
S3_RETENTION_DAYS=14
```

AWS S3, MinIO, and Backblaze B2 work the same way — point `S3_ENDPOINT` at
your store and set `S3_REGION` accordingly.

### Restore from the remote store

The boot restore runs automatically when `jobs.db` is missing. To force a
restore manually:

1. Stop JobOps and delete the local database (e.g. `rm data/jobs.db`).
2. Start JobOps — the latest remote snapshot is downloaded and migrated.
3. Verify jobs/runs in the UI.

## Troubleshooting

### Backups are not running automatically

- Confirm `backupEnabled` is true.
- Confirm backup hour is set as intended (UTC, not local time).
- Verify the app process is running at scheduled time.

### `POST /api/backups` fails

- Confirm the data directory and `jobs.db` are writable/readable.
- Confirm `jobs.db` exists.
- In demo mode, manual backup creation is blocked.

### Cannot delete a backup

- Filename must match valid backup patterns.
- Invalid names and missing files return errors.

### Next scheduled time is null

- Automatic backups are currently disabled.

## Notes

- Backup cleanup applies only to automatic backups.
- Manual backups stay until you delete them.

## Related pages

- [Settings](../features/settings)
- [Self-Hosting](./self-hosting)
