import { afterEach, describe, expect, it, vi } from "vitest";
import { ExtractorTimeoutError, withExtractorRunLock } from "./run-lock";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.useRealTimers();
});

describe("withExtractorRunLock", () => {
  it("serializes concurrent runs of the same manifest", async () => {
    let running = 0;
    let maxConcurrent = 0;

    const task = async (id: number) =>
      withExtractorRunLock("manifest-same", async () => {
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((resolve) => setTimeout(resolve, 25));
        running -= 1;
        return id;
      });

    const results = await Promise.all([task(1), task(2), task(3)]);
    expect(results).toEqual([1, 2, 3]);
    expect(maxConcurrent).toBe(1);
  });

  it("runs different manifests concurrently", async () => {
    let running = 0;
    let maxConcurrent = 0;

    const task = (manifestId: string) =>
      withExtractorRunLock(manifestId, async () => {
        running += 1;
        maxConcurrent = Math.max(maxConcurrent, running);
        await new Promise((resolve) => setTimeout(resolve, 25));
        running -= 1;
      });

    await Promise.all([task("m-a"), task("m-b")]);
    expect(maxConcurrent).toBe(2);
  });

  it("rejects a hung run after the timeout and releases the lock", async () => {
    process.env.EXTRACTOR_RUN_TIMEOUT_MS = "20";

    await expect(
      withExtractorRunLock("manifest-hung", () => new Promise<never>(() => {})),
    ).rejects.toBeInstanceOf(ExtractorTimeoutError);

    // The lock must be reusable after a timeout.
    const result = await withExtractorRunLock(
      "manifest-hung",
      async () => "ok",
    );
    expect(result).toBe("ok");
  });
});
