import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DeleteObjectsCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as remoteBackup from "./index";

vi.mock("@server/config/dataDir", () => ({
  getDataDir: vi.fn(),
}));

import { getDataDir } from "@server/config/dataDir";

function makeMockClient(
  sendImpl?: (command: object) => Promise<unknown>,
): remoteBackup.S3ClientLike {
  return { send: vi.fn(sendImpl ?? (async () => ({}))) };
}

async function createTestDb(dir: string): Promise<string> {
  const dbPath = path.join(dir, "jobs.db");
  const db = new Database(dbPath);
  try {
    db.exec(
      "CREATE TABLE IF NOT EXISTS test_items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);" +
        "INSERT INTO test_items (name) VALUES ('alpha');",
    );
  } finally {
    db.close();
  }
  return dbPath;
}

const FULL_CONFIG: remoteBackup.RemoteBackupConfig = {
  endpoint: "https://example.r2.cloudflarestorage.com",
  accessKeyId: "key",
  secretAccessKey: "secret",
  bucket: "bucket",
  region: "auto",
  prefix: "jobops",
  retentionDays: 14,
};

describe("Remote Backup Service", () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "remote-backup-"),
    );
    dbPath = await createTestDb(tempDir);
    vi.mocked(getDataDir).mockReturnValue(tempDir);
    remoteBackup.__resetRemoteBackupConfigForTests();
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.S3_BUCKET;
    delete process.env.S3_REGION;
    delete process.env.S3_PREFIX;
    delete process.env.S3_RETENTION_DAYS;
  });

  afterEach(async () => {
    try {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
    vi.clearAllMocks();
  });

  describe("getRemoteBackupConfig", () => {
    it("returns null when no variables are set", () => {
      expect(remoteBackup.getRemoteBackupConfig()).toBeNull();
      expect(remoteBackup.isRemoteBackupConfigured()).toBe(false);
    });

    it("returns null on partial config", () => {
      process.env.S3_ENDPOINT = "https://example.r2.cloudflarestorage.com";
      process.env.S3_ACCESS_KEY_ID = "key";
      expect(remoteBackup.getRemoteBackupConfig()).toBeNull();
    });

    it("parses a full config with defaults", () => {
      process.env.S3_ENDPOINT = "https://example.r2.cloudflarestorage.com";
      process.env.S3_ACCESS_KEY_ID = "key";
      process.env.S3_SECRET_ACCESS_KEY = "secret";
      process.env.S3_BUCKET = "bucket";

      const config = remoteBackup.getRemoteBackupConfig();
      expect(config).toEqual({
        endpoint: "https://example.r2.cloudflarestorage.com",
        accessKeyId: "key",
        secretAccessKey: "secret",
        bucket: "bucket",
        region: "auto",
        prefix: "jobops",
        retentionDays: 14,
      });
      expect(remoteBackup.isRemoteBackupConfigured()).toBe(true);
    });

    it("honors region, prefix, and retention overrides", () => {
      process.env.S3_ENDPOINT = "https://s3.us-east-1.amazonaws.com";
      process.env.S3_ACCESS_KEY_ID = "key";
      process.env.S3_SECRET_ACCESS_KEY = "secret";
      process.env.S3_BUCKET = "bucket";
      process.env.S3_REGION = "us-east-1";
      process.env.S3_PREFIX = "prod";
      process.env.S3_RETENTION_DAYS = "0";

      const config = remoteBackup.getRemoteBackupConfig();
      expect(config?.region).toBe("us-east-1");
      expect(config?.prefix).toBe("prod");
      expect(config?.retentionDays).toBe(0);
    });
  });

  describe("uploadDatabaseBackup", () => {
    it("no-ops when not configured", async () => {
      const client = makeMockClient();
      const result = await remoteBackup.uploadDatabaseBackup({ client });
      expect(result).toBeNull();
      expect(client.send).not.toHaveBeenCalled();
    });

    it("uploads a snapshot of the live database", async () => {
      const client = makeMockClient();
      const result = await remoteBackup.uploadDatabaseBackup({
        client,
        config: FULL_CONFIG,
      });

      expect(result).not.toBeNull();
      expect(client.send).toHaveBeenCalled();
      const command = vi.mocked(client.send).mock.calls[0][0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      const input = (command as PutObjectCommand).input;
      expect(input.Bucket).toBe("bucket");
      expect(input.Key).toMatch(/^jobops\/jobs_\d{4}-\d{2}-\d{2}T.*\.db$/);
      expect(input.Body).toBeInstanceOf(Buffer);
      expect((input.Body as Buffer).length).toBeGreaterThan(0);
    });

    it("returns null when the database is missing", async () => {
      await fs.promises.unlink(dbPath);
      const client = makeMockClient();
      const result = await remoteBackup.uploadDatabaseBackup({
        client,
        config: FULL_CONFIG,
      });
      expect(result).toBeNull();
      expect(client.send).not.toHaveBeenCalled();
    });

    it("cleans up the temporary snapshot file", async () => {
      const client = makeMockClient();
      await remoteBackup.uploadDatabaseBackup({ client, config: FULL_CONFIG });
      const leftovers = fs
        .readdirSync(os.tmpdir())
        .filter((name) => name.startsWith("jobops-remote-backup-"));
      expect(leftovers).toHaveLength(0);
    });
  });

  describe("restoreLatestRemoteBackup", () => {
    it("no-ops when not configured", async () => {
      const client = makeMockClient();
      const result = await remoteBackup.restoreLatestRemoteBackup(dbPath, {
        client,
      });
      expect(result).toBeNull();
      expect(client.send).not.toHaveBeenCalled();
    });

    it("returns null when the store is empty", async () => {
      const client = makeMockClient(async () => ({ Contents: [] }));
      const result = await remoteBackup.restoreLatestRemoteBackup(dbPath, {
        client,
        config: FULL_CONFIG,
      });
      expect(result).toBeNull();
    });

    it("downloads the most recent backup to the destination", async () => {
      const destPath = path.join(tempDir, "restored.db");
      const client = makeMockClient(async (command) => {
        if (command instanceof PutObjectCommand) return {};
        const bodyBytes = new Uint8Array([9, 8, 7]);
        return {
          Contents: [
            {
              Key: "jobops/jobs_2026-01-01T00:00:00.000Z_aaa.db",
              LastModified: new Date("2026-01-01T00:00:00Z"),
            },
            {
              Key: "jobops/jobs_2026-02-01T00:00:00.000Z_bbb.db",
              LastModified: new Date("2026-02-01T00:00:00Z"),
            },
            {
              Key: "jobops/other-file.txt",
              LastModified: new Date("2026-03-01T00:00:00Z"),
            },
          ],
          Body: { transformToByteArray: async () => bodyBytes },
        };
      });

      const restored = await remoteBackup.restoreLatestRemoteBackup(destPath, {
        client,
        config: FULL_CONFIG,
      });

      expect(restored).toBe("jobops/jobs_2026-02-01T00:00:00.000Z_bbb.db");
      expect(fs.readFileSync(destPath)).toEqual(Buffer.from([9, 8, 7]));
    });

    it("rethrows when strict and the store errors", async () => {
      const client = makeMockClient(async () => {
        throw new Error("connection refused");
      });
      await expect(
        remoteBackup.restoreLatestRemoteBackup(dbPath, {
          client,
          config: FULL_CONFIG,
          strict: true,
        }),
      ).rejects.toThrow("connection refused");
    });
  });

  describe("pruneRemoteBackups", () => {
    it("no-ops when retention is disabled", async () => {
      const client = makeMockClient();
      const deleted = await remoteBackup.pruneRemoteBackups({
        client,
        config: { ...FULL_CONFIG, retentionDays: 0 },
      });
      expect(deleted).toBe(0);
      expect(client.send).not.toHaveBeenCalled();
    });

    it("deletes only stale matching keys", async () => {
      const client = makeMockClient(async (command) => {
        if (command instanceof PutObjectCommand) return {};
        if (command instanceof DeleteObjectsCommand) {
          return { Deleted: [] };
        }
        return {
          Contents: [
            {
              Key: "jobops/jobs_2026-01-01T00:00:00.000Z_old.db",
              LastModified: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
            {
              Key: "jobops/jobs_2026-08-01T00:00:00.000Z_new.db",
              LastModified: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            },
            {
              Key: "jobops/notes.txt",
              LastModified: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
            },
          ],
        };
      });

      const deleted = await remoteBackup.pruneRemoteBackups({
        client,
        config: FULL_CONFIG,
      });

      expect(deleted).toBe(1);
      const deleteCall = vi
        .mocked(client.send)
        .mock.calls.find((call) => call[0] instanceof DeleteObjectsCommand);
      expect(deleteCall).toBeDefined();
      const input = (
        deleteCall?.[0] as {
          input: { Delete: { Objects: Array<{ Key: string }> } };
        }
      ).input;
      expect(input.Delete.Objects).toEqual([
        { Key: "jobops/jobs_2026-01-01T00:00:00.000Z_old.db" },
      ]);
    });
  });
});
