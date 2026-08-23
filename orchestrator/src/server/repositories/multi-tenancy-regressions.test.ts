/**
 * Data-layer multi-tenancy regressions for the surfaces that were
 * globally-keyed: job URL uniqueness, dedup fingerprints, design-resume
 * assets, tracer analytics, and stage-event id scoping.
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("multi-tenancy isolation regressions", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";
  let closeDb: (() => void) | null = null;
  let runWithRequestContext: typeof import("@infra/request-context").runWithRequestContext;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-tenancy-regressions-"));
    process.env = {
      ...originalEnv,
      DATA_DIR: tempDir,
      NODE_ENV: "test",
    };

    const requestContextModule = await import("@infra/request-context");
    runWithRequestContext = requestContextModule.runWithRequestContext;

    await import("../db/migrate");
    const dbModule = await import("../db");
    closeDb = dbModule.closeDb;
  });

  afterEach(async () => {
    closeDb?.();
    closeDb = null;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    process.env = { ...originalEnv };
  });

  it("lets two users save the same job URL (per-account uniqueness)", async () => {
    const jobsRepo = await import("./jobs");
    const sharedUrl = "https://example.com/listings/shared";

    const jobA = await runWithRequestContext({ userId: "user-a" }, () =>
      jobsRepo.createJobs({
        source: "hiringcafe",
        title: "Shared listing",
        employer: "Corp",
        jobUrl: sharedUrl,
      }),
    );
    expect(jobA).toBeTruthy();

    // Previously the global job_url UNIQUE silently swallowed user B's row.
    const jobB = await runWithRequestContext({ userId: "user-b" }, () =>
      jobsRepo.createJobs({
        source: "hiringcafe",
        title: "Shared listing",
        employer: "Corp",
        jobUrl: sharedUrl,
      }),
    );
    expect(jobB).toBeTruthy();
    expect((jobB as { id: string }).id).not.toBe((jobA as { id: string }).id);

    // Dedup within the same account still applies.
    const batch = await runWithRequestContext({ userId: "user-c" }, () =>
      jobsRepo.createJobs(
        [
          {
            source: "hiringcafe",
            title: "T1",
            employer: "Corp",
            jobUrl: "https://example.com/listings/c1",
          },
          {
            source: "hiringcafe",
            title: "T1 duplicate",
            employer: "Corp",
            jobUrl: "https://example.com/listings/c1",
          },
        ],
        { discoveredByRunId: null },
      ),
    );
    expect(batch.created).toBe(1);
    expect(batch.skipped).toBe(1);
  });

  it("scopes dedup fingerprints per user", async () => {
    const dedupRepo = await import("./dedup-fingerprints");

    await runWithRequestContext({ userId: "user-a" }, () =>
      dedupRepo.recordFingerprints([
        { fingerprint: "fp-shared", canonicalJobUrl: "https://x.test/1" },
      ]),
    );

    const seenByA = await runWithRequestContext({ userId: "user-a" }, () =>
      dedupRepo.hasFingerprint("fp-shared"),
    );
    expect(seenByA).toBe(true);

    // Previously the fingerprint table was global: B's crawl results were
    // suppressed by A's history.
    const seenByB = await runWithRequestContext({ userId: "user-b" }, () =>
      dedupRepo.hasFingerprint("fp-shared"),
    );
    expect(seenByB).toBe(false);

    await runWithRequestContext({ userId: "user-b" }, () =>
      dedupRepo.recordFingerprints([
        { fingerprint: "fp-shared", canonicalJobUrl: "https://x.test/1" },
      ]),
    );
    const seenByBAfter = await runWithRequestContext({ userId: "user-b" }, () =>
      dedupRepo.hasFingerprint("fp-shared"),
    );
    expect(seenByBAfter).toBe(true);
  });

  it("resolves design-resume assets only through an owned document", async () => {
    const designResumeRepo = await import("./design-resume");
    const { writeFile } = await import("node:fs/promises");

    const assetId = await runWithRequestContext(
      { userId: "user-a" },
      async () => {
        await designResumeRepo.upsertDesignResumeDocument({
          id: "doc-a",
          title: "A's resume",
          resumeJson: {},
          revision: 1,
          sourceResumeId: null,
          sourceMode: null,
          importedAt: null,
          updatedAt: new Date().toISOString(),
        });
        const storagePath = join(tempDir, "asset.png");
        await writeFile(storagePath, "bytes");
        const asset = await designResumeRepo.insertDesignResumeAsset({
          id: "asset-a",
          documentId: "doc-a",
          kind: "picture",
          originalName: "photo.png",
          mimeType: "image/png",
          byteSize: 5,
          storagePath,
          updatedAt: new Date().toISOString(),
        });
        return asset?.id ?? "asset-a";
      },
    );

    const asOwner = await runWithRequestContext({ userId: "user-a" }, () =>
      designResumeRepo.getDesignResumeAssetById(assetId),
    );
    expect(asOwner).toBeTruthy();

    const asIntruder = await runWithRequestContext({ userId: "user-b" }, () =>
      designResumeRepo.getDesignResumeAssetById(assetId),
    );
    expect(asIntruder).toBeNull();
  });

  it("scopes tracer analytics totals per user", async () => {
    const jobsRepo = await import("./jobs");
    const tracerRepo = await import("./tracer-links");

    const jobA = await runWithRequestContext({ userId: "user-a" }, () =>
      jobsRepo.createJobs({
        source: "hiringcafe",
        title: "A job",
        employer: "Corp",
        jobUrl: "https://example.com/tracer/a",
      }),
    );

    await runWithRequestContext({ userId: "user-a" }, async () => {
      const link = await tracerRepo.getOrCreateTracerLink({
        jobId: (jobA as { id: string }).id,
        sourcePath: "/resume",
        sourceLabel: "Resume",
        destinationUrl: "https://example.com/d",
        destinationUrlHash: "h",
        slugPrefix: "a",
      });
      await tracerRepo.insertTracerClickEvent({
        tracerLinkId: link.id,
        clickedAt: Math.floor(Date.now() / 1000),
        requestId: null,
        isLikelyBot: false,
        deviceType: "desktop",
        uaFamily: "chrome",
        osFamily: "macos",
        referrerHost: null,
        ipHash: null,
        uniqueFingerprintHash: "fp",
      });
    });

    const totalsForA = await runWithRequestContext({ userId: "user-a" }, () =>
      tracerRepo.getTracerAnalyticsTotals({}),
    );
    expect(totalsForA.clicks).toBe(1);

    const totalsForB = await runWithRequestContext({ userId: "user-b" }, () =>
      tracerRepo.getTracerAnalyticsTotals({}),
    );
    expect(totalsForB.clicks).toBe(0);
  });

  it("rejects stage-event updates that cross applications", async () => {
    const jobsRepo = await import("./jobs");
    const { transitionStage, updateStageEvent, deleteStageEvent } =
      await import("../services/applicationTracking");

    const jobA = await runWithRequestContext({ userId: "user-a" }, () =>
      jobsRepo.createJobs({
        source: "hiringcafe",
        title: "A job",
        employer: "Corp",
        jobUrl: "https://example.com/stage/a",
      }),
    );
    const jobB = await runWithRequestContext({ userId: "user-a" }, () =>
      jobsRepo.createJobs({
        source: "hiringcafe",
        title: "B job",
        employer: "Corp",
        jobUrl: "https://example.com/stage/b",
      }),
    );

    const event = runWithRequestContext({ userId: "user-a" }, () =>
      transitionStage((jobA as { id: string }).id, "applied"),
    );

    expect(() =>
      runWithRequestContext({ userId: "user-a" }, () =>
        updateStageEvent(
          event.id,
          { toStage: "offer" },
          (jobB as { id: string }).id,
        ),
      ),
    ).toThrow(/not found/i);

    expect(() =>
      runWithRequestContext({ userId: "user-a" }, () =>
        deleteStageEvent(event.id, (jobB as { id: string }).id),
      ),
    ).toThrow(/not found/i);

    // The event survives the rejected mutation attempts.
    const intact = runWithRequestContext({ userId: "user-a" }, () =>
      transitionStage((jobA as { id: string }).id, "no_change"),
    );
    expect(intact.fromStage).toBe("applied");
  });
});
