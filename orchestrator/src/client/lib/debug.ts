/**
 * Minimal client-side debug logger. Mirrors the server's verbose console
 * logging in the browser: every line is prefixed with `[jobops]` and emitted
 * at `console.debug` level so browser devtools can filter it.
 */
export function clientDebug(message: string, meta?: unknown): void {
  if (meta === undefined) {
    console.debug(`[jobops] ${message}`);
  } else {
    console.debug(`[jobops] ${message}`, meta);
  }
}
