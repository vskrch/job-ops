/**
 * Per-manifest extractor run lock (serialization + hard timeout).
 *
 * Extractor workspaces are fixed-path (Crawlee datasets, scratch JSON
 * files, browser profile dirs) and are cleared at the start of each run,
 * so two concurrent invocations of the same manifest clobber each other's
 * files and mix results — whether they come from a pipeline, a scheduled
 * run, or a manual job search. Serializing per manifest id makes those
 * workspaces single-flight without touching every extractor.
 *
 * The timeout bounds hung runs (a browser child stuck on a bot wall would
 * otherwise hold its pipeline step forever). The child process itself
 * cannot be force-killed from here — extractors do not expose a kill
 * protocol yet — so a timed-out run's children may linger, but the
 * pipeline/search step fails fast and the lock is released.
 */

import { logger } from "@infra/logger";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

const locks = new Map<string, Promise<unknown>>();

export class ExtractorTimeoutError extends Error {
  readonly manifestId: string;
  readonly timeoutMs: number;

  constructor(manifestId: string, timeoutMs: number) {
    super(
      `Extractor "${manifestId}" timed out after ${Math.round(timeoutMs / 1000)}s`,
    );
    this.manifestId = manifestId;
    this.timeoutMs = timeoutMs;
    this.name = "ExtractorTimeoutError";
  }
}

function extractorTimeoutMs(): number {
  const raw = Number(process.env.EXTRACTOR_RUN_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

export async function withExtractorRunLock<T>(
  manifestId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(manifestId) ?? Promise.resolve();
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.then(() => gate);
  locks.set(manifestId, chained);
  await previous;

  const timeoutMs = extractorTimeoutMs();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          logger.warn("Extractor run timed out", {
            manifestId,
            timeoutMs,
          });
          reject(new ExtractorTimeoutError(manifestId, timeoutMs));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    release?.();
  }
}
