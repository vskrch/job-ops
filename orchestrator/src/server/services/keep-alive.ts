import { logger } from "@infra/logger";

const PING_INTERVAL_MS = 14 * 60 * 1000; // 14 minutes (under Heroku's 30-min idle threshold)

let keepAliveInterval: ReturnType<typeof setInterval> | null = null;

export function resolvePublicBaseUrl(): string | null {
  if (process.env.JOBOPS_PUBLIC_BASE_URL?.trim()) {
    return process.env.JOBOPS_PUBLIC_BASE_URL.trim().replace(/\/+$/, "");
  }
  if (process.env.HEROKU_APP_NAME?.trim()) {
    return `https://${process.env.HEROKU_APP_NAME.trim()}.herokuapp.com`;
  }
  return null;
}

export function startKeepAliveService(): void {
  if (keepAliveInterval) return;

  const baseUrl = resolvePublicBaseUrl();
  if (!baseUrl) {
    logger.info(
      "Self-ping keep-alive service disabled (no JOBOPS_PUBLIC_BASE_URL or HEROKU_APP_NAME configured).",
    );
    return;
  }

  const pingUrl = `${baseUrl}/api/settings`;
  logger.info("Starting self-ping keep-alive service", {
    pingUrl,
    intervalMinutes: 14,
  });

  keepAliveInterval = setInterval(async () => {
    try {
      const response = await fetch(pingUrl, {
        method: "GET",
        headers: { "User-Agent": "JobOps-KeepAlive/1.0" },
      });
      logger.debug("Keep-alive self-ping completed", {
        status: response.status,
        pingUrl,
      });
    } catch (error) {
      logger.warn("Keep-alive self-ping failed", {
        pingUrl,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, PING_INTERVAL_MS);
}

export function stopKeepAliveService(): void {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}
