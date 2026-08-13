/**
 * Minimal structured logger for the `shared/` package.
 *
 * The orchestrator injects a real logger via `setLogger()`. When unset,
 * we fall back to `console.warn` / `console.error` — explicitly violating
 * the "no console" rule, but only when the logger isn't wired up (tests,
 * extracted usage, sidecar callers). Production hosts must call
 * `setLogger()` at startup so AGENTS.md §Logging Rules are followed.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

let active: Logger | null = null;

/** Inject a logger (called by orchestrator at startup). */
export function setLogger(logger: Logger): void {
  active = logger;
}

/** Current logger, or a console-based fallback when unset. */
export const logger: Logger = active ?? fallbackLogger();

function fallbackLogger(): Logger {
  return {
    debug: (msg, meta) => emit("debug", msg, meta),
    info: (msg, meta) => emit("info", msg, meta),
    warn: (msg, meta) => emit("warn", msg, meta),
    error: (msg, meta) => emit("error", msg, meta),
  };
}

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  const payload = JSON.stringify({ level, msg, meta: redact(meta ?? {}) });
  if (level === "error") console.error(payload);
  else if (level === "warn") console.warn(payload);
  else console.log(payload);
}

const REDACTED_KEYS = new Set([
  "authorization",
  "cookie",
  "password",
  "secret",
  "token",
  "apikey",
  "apiKey",
  "api_key",
  "set-cookie",
]);

function redact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = REDACTED_KEYS.has(k.toLowerCase()) ? "[REDACTED]" : v;
  }
  return out;
}
