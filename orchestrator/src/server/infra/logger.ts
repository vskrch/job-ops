import { getRequestContext } from "./request-context";
import { sanitizeError, sanitizeUnknown } from "./sanitize";

type LogLevel = "debug" | "info" | "warn" | "error";

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const LOG_LEVEL_ALIASES: Record<string, LogLevel> = {
  verbose: "debug",
  trace: "debug",
};

/**
 * Resolve the configured minimum log level from LOG_LEVEL.
 * Defaults to "info" for production-appropriate output. Set LOG_LEVEL=debug
 * for full verbose console output; "verbose" and "trace" are aliases for "debug".
 */
export function getConfiguredLogLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL?.toLowerCase();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return raw ? (LOG_LEVEL_ALIASES[raw] ?? "info") : "info";
}

export function isDebugLoggingEnabled(): boolean {
  return getConfiguredLogLevel() === "debug";
}

function getMinLevel(): LogLevel {
  return getConfiguredLogLevel();
}

export class Logger {
  constructor(private readonly context: Record<string, unknown> = {}) {}

  child(context: Record<string, unknown>): Logger {
    return new Logger({ ...this.context, ...context });
  }

  debug(message: string, meta?: unknown): void {
    this.log("debug", message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log("info", message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log("warn", message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log("error", message, meta);
  }

  private log(level: LogLevel, message: string, meta?: unknown): void {
    if (levelPriority[level] < levelPriority[getMinLevel()]) return;

    const requestContext = getRequestContext();
    const payload: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...this.context,
      ...(requestContext ?? {}),
    };

    if (meta !== undefined) {
      payload.meta =
        meta instanceof Error ? sanitizeError(meta) : sanitizeUnknown(meta);
    }

    const line = JSON.stringify(payload);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

export const logger = new Logger();
