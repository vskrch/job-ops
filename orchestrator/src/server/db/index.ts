/**
 * Database connection and initialization.
 */

import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { isDebugLoggingEnabled, logger } from "@infra/logger";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { getDataDir } from "../config/dataDir";
import { runMigrations } from "./migrate";
import * as schema from "./schema";

// Database path - can be overridden via env for Docker
const DB_PATH = join(getDataDir(), "jobs.db");

// Ensure data directory exists with restricted permissions (contains plaintext secrets)
const dataDir = dirname(DB_PATH);
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
} else {
  try {
    chmodSync(dataDir, 0o700);
  } catch {
    // Non-critical — best effort
  }
}

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("busy_timeout = 10000");
let isClosed = false;

// Run migrations automatically on startup so the server never boots
// against a schema-less database (fresh installs, new environments).
try {
  runMigrations(sqlite);
} catch (error) {
  logger.error("Database migration failed on startup", {
    error: error instanceof Error ? error.message : String(error),
  });
  throw error;
}

export const db = drizzle(sqlite, {
  schema,
  ...(isDebugLoggingEnabled()
    ? {
        logger: {
          logQuery: (query: string, params: unknown[]) =>
            logger.debug("SQL query", { query, params }),
        },
      }
    : {}),
});

export { schema };

export function closeDb() {
  if (isClosed) return;
  sqlite.close();
  isClosed = true;
}
