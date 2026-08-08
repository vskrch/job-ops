/**
 * Remote (S3-compatible) database backup/restore.
 *
 * Mirrors the SQLite `jobs.db` to any S3-compatible object store
 * (Cloudflare R2, AWS S3, MinIO, Backblaze B2, ...) so data survives
 * ephemeral filesystems — e.g. Heroku containers where /app/data is
 * recreated on every boot.
 *
 * Flow:
 *   1. Boot: `db/restore-remote.ts` restores the latest remote copy when
 *      `jobs.db` is missing (run before migrations).
 *   2. Runtime: the DB is uploaded after every successful local backup
 *      (manual or automatic), at startup, and during graceful shutdown.
 *   3. Retention: keys older than `S3_RETENTION_DAYS` are pruned.
 *
 * Everything is optional: when the `S3_*` variables are missing the module
 * is inert and all functions no-op safely.
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { getDataDir } from "@server/config/dataDir";
import Database from "better-sqlite3";

const DB_FILENAME = "jobs.db";
const DEFAULT_REGION = "auto";
const DEFAULT_PREFIX = "jobops";
const DEFAULT_RETENTION_DAYS = 14;
const REMOTE_KEY_PATTERN = /^jobs_\d{4}-\d{2}-\d{2}T.*\.db$/;

export interface RemoteBackupConfig {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
  prefix: string;
  retentionDays: number;
}

export type S3ClientLike = Pick<S3Client, "send">;

let cachedConfig: RemoteBackupConfig | null | undefined;

export function getRemoteBackupConfig(): RemoteBackupConfig | null {
  if (cachedConfig !== undefined) return cachedConfig;

  const endpoint = (process.env.S3_ENDPOINT || "").trim();
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (process.env.S3_SECRET_ACCESS_KEY || "").trim();
  const bucket = (process.env.S3_BUCKET || "").trim();

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
    cachedConfig = null;
    return null;
  }

  const retentionRaw = Number.parseInt(
    (process.env.S3_RETENTION_DAYS || "").trim(),
    10,
  );
  cachedConfig = {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    region: (process.env.S3_REGION || "").trim() || DEFAULT_REGION,
    prefix: (process.env.S3_PREFIX || "").trim() || DEFAULT_PREFIX,
    retentionDays: Number.isFinite(retentionRaw)
      ? Math.max(0, retentionRaw)
      : DEFAULT_RETENTION_DAYS,
  };
  return cachedConfig;
}

export function isRemoteBackupConfigured(): boolean {
  return getRemoteBackupConfig() !== null;
}

/** Test-only: forget the cached config so env changes are re-read. */
export function __resetRemoteBackupConfigForTests(): void {
  cachedConfig = undefined;
}

export function createS3Client(config: RemoteBackupConfig): S3Client {
  const options: S3ClientConfig = {
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  };
  // S3-compatible stores (R2, MinIO, B2) usually serve from a custom origin.
  const endpoint = new URL(config.endpoint);
  if (
    !["s3.amazonaws.com", "s3.us-east-1.amazonaws.com"].includes(endpoint.host)
  ) {
    options.endpoint = endpoint.toString();
    options.forcePathStyle = true;
  }
  return new S3Client(options);
}

function getClient(config: RemoteBackupConfig): S3Client {
  return createS3Client(config);
}

function toKey(config: RemoteBackupConfig, filename: string): string {
  return `${config.prefix}/${filename}`;
}

function generateRemoteFilename(): string {
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const suffix = createHash("sha256")
    .update(randomUUID())
    .digest("hex")
    .slice(0, 8);
  return `jobs_${stamp}_${suffix}.db`;
}

interface UploadResult {
  key: string;
  filename: string;
  bytes: number;
}

/**
 * Create a consistent snapshot of `jobs.db` (via SQLite online backup) and
 * upload it to the remote store. Returns the uploaded key, or null when the
 * remote store is not configured or the database is missing.
 */
export async function uploadDatabaseBackup(options?: {
  client?: S3ClientLike;
  config?: RemoteBackupConfig;
}): Promise<UploadResult | null> {
  const config = options?.config ?? getRemoteBackupConfig();
  if (!config) return null;

  const dbPath = path.join(getDataDir(), DB_FILENAME);
  if (!fs.existsSync(dbPath)) return null;

  const tmpPath = path.join(
    os.tmpdir(),
    `jobops-remote-backup-${randomUUID()}.db`,
  );

  try {
    let sqlite: Database.Database | null = null;
    try {
      sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
      await sqlite.backup(tmpPath);
    } finally {
      sqlite?.close();
    }

    const body = await fs.promises.readFile(tmpPath);
    const filename = generateRemoteFilename();
    const key = toKey(config, filename);
    const client = options?.client ?? getClient(config);

    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: "application/octet-stream",
      }),
    );

    logger.info("Uploaded database backup to remote store", {
      bucket: config.bucket,
      key,
      bytes: body.length,
    });

    await pruneRemoteBackups({ client, config });

    return { key, filename, bytes: body.length };
  } catch (error) {
    logger.error("Failed to upload database backup to remote store", {
      bucket: config.bucket,
      error: sanitizeUnknown(error),
    });
    return null;
  } finally {
    await fs.promises.unlink(tmpPath).catch(() => undefined);
  }
}

/**
 * Download the most recent remote backup to `destPath`.
 * Returns the restored key, or null when the store is unconfigured or empty.
 * Does not throw on remote failures — callers decide how to proceed.
 */
export async function restoreLatestRemoteBackup(
  destPath: string,
  options?: {
    client?: S3ClientLike;
    config?: RemoteBackupConfig;
    /** Rethrow remote-store failures instead of returning null (boot safety). */
    strict?: boolean;
  },
): Promise<string | null> {
  const config = options?.config ?? getRemoteBackupConfig();
  if (!config) return null;

  const client = options?.client ?? getClient(config);

  try {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: `${config.prefix}/`,
      }),
    );

    const candidates = (list.Contents ?? [])
      .filter(
        (entry) =>
          entry.Key &&
          entry.LastModified &&
          REMOTE_KEY_PATTERN.test(entry.Key.split("/").pop() ?? ""),
      )
      .sort(
        (a, b) =>
          (b.LastModified?.getTime() ?? 0) - (a.LastModified?.getTime() ?? 0),
      );

    if (candidates.length === 0) return null;

    const latest = candidates[0];
    const response = await client.send(
      new GetObjectCommand({
        Bucket: config.bucket,
        Key: latest.Key,
      }),
    );

    const body = await response.Body?.transformToByteArray();
    if (!body) return null;

    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    await writeFile(destPath, Buffer.from(body));

    logger.info("Restored database from remote store", {
      bucket: config.bucket,
      key: latest.Key,
      bytes: body.length,
    });
    return latest.Key ?? null;
  } catch (error) {
    if (options?.strict) throw error;
    logger.error("Failed to restore database from remote store", {
      bucket: config.bucket,
      destPath,
      error: sanitizeUnknown(error),
    });
    return null;
  }
}

/**
 * Delete remote backups older than the configured retention window.
 * Returns the number of deleted keys (0 when pruning is disabled).
 */
export async function pruneRemoteBackups(options?: {
  client?: S3ClientLike;
  config?: RemoteBackupConfig;
}): Promise<number> {
  const config = options?.config ?? getRemoteBackupConfig();
  if (!config || config.retentionDays <= 0) return 0;

  const client = options?.client ?? getClient(config);
  const cutoff = Date.now() - config.retentionDays * 24 * 60 * 60 * 1000;

  try {
    const list = await client.send(
      new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: `${config.prefix}/`,
      }),
    );

    const staleKeys = (list.Contents ?? [])
      .filter(
        (entry) =>
          entry.Key &&
          entry.LastModified &&
          REMOTE_KEY_PATTERN.test(entry.Key.split("/").pop() ?? "") &&
          entry.LastModified.getTime() < cutoff,
      )
      .map((entry) => ({ Key: entry.Key as string }));

    if (staleKeys.length === 0) return 0;

    await client.send(
      new DeleteObjectsCommand({
        Bucket: config.bucket,
        Delete: { Objects: staleKeys },
      }),
    );

    logger.info("Pruned stale remote database backups", {
      bucket: config.bucket,
      deletedCount: staleKeys.length,
      retentionDays: config.retentionDays,
    });
    return staleKeys.length;
  } catch (error) {
    logger.error("Failed to prune remote database backups", {
      bucket: config.bucket,
      error: sanitizeUnknown(error),
    });
    return 0;
  }
}

/** Convenience: upload the live database and prune stale keys. */
export async function syncBackupToRemote(): Promise<UploadResult | null> {
  return uploadDatabaseBackup();
}
