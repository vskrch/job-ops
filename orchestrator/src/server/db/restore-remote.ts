/**
 * Boot-time database restore from the remote (S3-compatible) store.
 *
 * Runs BEFORE migrations (see heroku.yml / Dockerfile CMD). Restores the
 * latest remote snapshot only when `jobs.db` is missing (e.g. ephemeral
 * Heroku filesystems where /app/data is fresh each boot).
 *
 * Exit codes:
 *   0 — nothing to do, restored successfully, or store not configured.
 *   1 — store is configured but restore FAILED (protects the remote copy
 *       from being overwritten by a fresh, empty database).
 */

import fs from "node:fs";
import path from "node:path";
import "../config/env";
import { logger } from "@infra/logger";
import { getDataDir } from "@server/config/dataDir";
import {
  getRemoteBackupConfig,
  isRemoteBackupConfigured,
  restoreLatestRemoteBackup,
} from "@server/services/remote-backup";

const DB_FILENAME = "jobs.db";

async function main(): Promise<number> {
  if (!isRemoteBackupConfigured()) {
    logger.info("Remote backup store not configured. Skipping restore.");
    return 0;
  }

  const config = getRemoteBackupConfig();
  const dbPath = path.join(getDataDir(), DB_FILENAME);
  if (fs.existsSync(dbPath)) {
    logger.info("Database already exists. Skipping remote restore.", {
      dbPath,
    });
    return 0;
  }

  logger.info("Database missing. Attempting restore from remote store.", {
    bucket: config?.bucket,
  });

  const restored = await restoreLatestRemoteBackup(dbPath, { strict: true });
  if (restored) {
    logger.info("Restored database from remote backup", { key: restored });
  } else {
    logger.info("No remote backup found. Starting with a fresh database.");
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    logger.error(
      "Remote restore failed. Refusing to start with a fresh database.",
      {
        error,
      },
    );
    process.exitCode = 1;
  });
