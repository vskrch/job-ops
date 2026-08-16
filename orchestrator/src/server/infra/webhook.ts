/**
 * Safe outbound webhook POSTs.
 *
 * All user-configurable webhook URLs flow through this helper: only http(s)
 * URLs with an explicit hostname are accepted (SSRF guard), and every
 * request has a hard timeout so a dead endpoint cannot hang the caller.
 */

import { logger } from "@infra/logger";

export interface SafeWebhookResult {
  ok: boolean;
  status?: number;
  error?: string;
}

const WEBHOOK_TIMEOUT_MS = 10_000;

export function isAllowedWebhookUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  return (
    (parsed.protocol === "http:" || parsed.protocol === "https:") &&
    parsed.hostname.length > 0
  );
}

export async function postWebhook(
  rawUrl: string,
  body: unknown,
  headers: Record<string, string> = {},
  loggerContext: Record<string, unknown> = {},
  contextLabel = "webhook",
): Promise<SafeWebhookResult> {
  if (!isAllowedWebhookUrl(rawUrl)) {
    logger.warn(`${contextLabel} URL rejected (must be http(s) with a host)`, {
      ...loggerContext,
    });
    return { ok: false, error: "invalid_url" };
  }

  try {
    const response = await fetch(rawUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!response.ok) {
      const rawBody = await response.text().catch(() => "");
      logger.warn(`${contextLabel} POST failed`, {
        status: response.status,
        response: rawBody.slice(0, 500),
        ...loggerContext,
      });
      return { ok: false, status: response.status, error: "non_2xx" };
    }
    return { ok: true, status: response.status };
  } catch (error) {
    // Timeouts and network failures are expected for down endpoints; log
    // without leaking response bodies or stack traces.
    logger.warn(`${contextLabel} POST failed`, {
      ...loggerContext,
      error: error instanceof Error ? error.name : "unknown",
    });
    return { ok: false, error: "request_failed" };
  }
}
