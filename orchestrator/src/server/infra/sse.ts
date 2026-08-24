import type { Response } from "express";
import { logger } from "./logger";

interface SetupSseOptions {
  cacheControl?: string;
  disableBuffering?: boolean;
  flushHeaders?: boolean;
}

const DEFAULT_HEARTBEAT_MS = 30_000;

export function setupSse(res: Response, options: SetupSseOptions = {}): void {
  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", options.cacheControl ?? "no-cache");
  res.setHeader("Connection", "keep-alive");

  logger.debug("SSE connection opened", {
    path: res.req?.originalUrl ?? res.req?.url,
  });

  if (options.disableBuffering) {
    res.setHeader("X-Accel-Buffering", "no");
  }

  if (options.flushHeaders) {
    res.flushHeaders?.();
  }
}

function isResponseWritable(res: Response): boolean {
  return !res.writableEnded && !res.destroyed;
}

export function writeSseData(res: Response, data: unknown): void {
  if (!isResponseWritable(res)) return;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // Client disconnected — silently ignore write after close
  }
}

export function writeSseComment(res: Response, comment: string): void {
  if (!isResponseWritable(res)) return;
  try {
    res.write(`: ${comment}\n\n`);
  } catch {
    // Client disconnected — silently ignore
  }
}

export function startSseHeartbeat(
  res: Response,
  intervalMs = DEFAULT_HEARTBEAT_MS,
): () => void {
  const heartbeat = setInterval(() => {
    if (!isResponseWritable(res)) return;
    writeSseComment(res, "heartbeat");
  }, intervalMs);

  return () => {
    clearInterval(heartbeat);
  };
}
