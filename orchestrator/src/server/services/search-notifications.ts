/**
 * Search notification service — sends email, webhook, and Telegram
 * notifications after a scheduled search completes.
 *
 * All notification channels are best-effort: failures are logged but never
 * throw, so the search result itself is never affected.
 */

import { redactString, sanitizeWebhookPayload } from "@infra/sanitize";
import { logger } from "@infra/logger";
import * as settingsRepo from "@server/repositories/settings";
import type {
  JobSearch,
  JobSearchResultItem,
} from "@shared/types";

const MAX_WEBHOOK_JOBS = 10;
const MAX_TELEGRAM_JOBS = 5;

function getPublicBaseUrl(): string {
  return process.env.JOBOPS_PUBLIC_BASE_URL?.trim() || "http://localhost:3001";
}

interface NotificationContext {
  scheduleId: string;
  scheduleLabel: string;
  searchId: string;
  query: string;
  resultsCount: number;
  jobs: JobSearchResultItem[];
}

/**
 * Send a search results email if the search is completed and email is
 * configured. Reuses the existing `sendSearchResultsEmail` helper.
 */
async function sendEmailNotification(
  search: JobSearch,
  notifyLog: Record<string, unknown>,
): Promise<void> {
  try {
    if (search.status !== "completed") {
      logger.info("Skipping scheduled-search email: search not completed", {
        ...notifyLog,
        status: search.status,
      });
      return;
    }
    const { sendSearchResultsEmail } = await import("./email");
    const result = await sendSearchResultsEmail(search, getPublicBaseUrl());
    if (result.success) {
      logger.info("Scheduled-search email sent", notifyLog);
    } else {
      logger.info("Scheduled-search email skipped/failed", {
        ...notifyLog,
        error: result.error,
      });
    }
  } catch (error) {
    logger.warn("Scheduled-search email notification failed", {
      ...notifyLog,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Send a sanitized webhook POST with the search results summary.
 * Follows the notify-webhook.ts pattern: Bearer auth with WEBHOOK_SECRET,
 * sanitized payload, minimal whitelisted fields.
 */
async function sendWebhookNotification(
  ctx: NotificationContext,
  notifyLog: Record<string, unknown>,
): Promise<void> {
  try {
    const overrideUrl = await settingsRepo.getSetting("searchWebhookUrl");
    const webhookUrl = (
      overrideUrl ||
      process.env.SEARCH_WEBHOOK_URL ||
      process.env.PIPELINE_WEBHOOK_URL ||
      process.env.WEBHOOK_URL ||
      ""
    ).trim();

    if (!webhookUrl) {
      logger.info("Skipping scheduled-search webhook: no URL configured", {
        ...notifyLog,
      });
      return;
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const secret = process.env.WEBHOOK_SECRET;
    if (secret) headers.Authorization = `Bearer ${secret}`;

    const topJobs = ctx.jobs.slice(0, MAX_WEBHOOK_JOBS).map((item) => ({
      title: item.job.title,
      employer: item.job.employer,
      location: item.job.location ?? null,
      jobUrl: item.job.jobUrl ?? null,
      salary: item.job.salary ?? null,
      relevanceScore: item.relevanceScore,
    }));

    const sanitizedPayload = sanitizeWebhookPayload({
      event: "search.scheduled_complete",
      sentAt: new Date().toISOString(),
      scheduleId: ctx.scheduleId,
      scheduleLabel: ctx.scheduleLabel,
      searchId: ctx.searchId,
      query: ctx.query,
      resultsCount: ctx.resultsCount,
      topJobs,
      resultsUrl: `${getPublicBaseUrl()}/job-search/${ctx.searchId}`,
    });

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(sanitizedPayload),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      logger.warn("Scheduled-search webhook POST failed", {
        ...notifyLog,
        status: response.status,
        error: redactString(responseText),
      });
    } else {
      logger.info("Scheduled-search webhook sent", notifyLog);
    }
  } catch (error) {
    logger.warn("Scheduled-search webhook notification failed", {
      ...notifyLog,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Send a Telegram message with a concise summary of the top jobs.
 * Requires both `telegramBotToken` (secret) and `telegramChatId` to be set.
 */
async function sendTelegramNotification(
  ctx: NotificationContext,
  notifyLog: Record<string, unknown>,
): Promise<void> {
  try {
    const token =
      (await settingsRepo.getSetting("telegramBotToken")) ||
      process.env.TELEGRAM_BOT_TOKEN ||
      "";
    const chatIdOverride = await settingsRepo.getSetting("telegramChatId");
    const chatId = (chatIdOverride || process.env.TELEGRAM_CHAT_ID || "").trim();

    if (!token.trim() || !chatId) {
      logger.info("Skipping scheduled-search Telegram: not configured", {
        ...notifyLog,
      });
      return;
    }

    const topJobs = ctx.jobs.slice(0, MAX_TELEGRAM_JOBS);
    const lines: string[] = [
      `🔍 *${ctx.scheduleLabel}* — scheduled search complete`,
      ``,
      `Query: ${ctx.query}`,
      `Results: ${ctx.resultsCount} job${ctx.resultsCount === 1 ? "" : "s"}`,
      ``,
    ];

    for (const [i, item] of topJobs.entries()) {
      const title = escapeTelegramText(item.job.title);
      const employer = escapeTelegramText(item.job.employer);
      const location = item.job.location
        ? escapeTelegramText(item.job.location)
        : "Location not specified";
      const link = item.job.jobUrl || item.job.applicationLink || "";
      const jobLine = link
        ? `${i + 1}. [${title}](${link})`
        : `${i + 1}. ${title}`;
      lines.push(jobLine);
      lines.push(`   ${employer} — ${location}`);
    }

    if (ctx.resultsCount > topJobs.length) {
      lines.push("");
      lines.push(`...and ${ctx.resultsCount - topJobs.length} more.`);
    }

    lines.push("");
    lines.push(`View full results: ${getPublicBaseUrl()}/job-search/${ctx.searchId}`);

    const apiUrl = `https://api.telegram.org/bot${token.trim()}/sendMessage`;
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: lines.join("\n"),
        parse_mode: "MarkdownV2",
        disable_web_page_preview: true,
      }),
    });

    if (!response.ok) {
      const responseText = await response.text().catch(() => "");
      logger.warn("Scheduled-search Telegram sendMessage failed", {
        ...notifyLog,
        status: response.status,
        error: redactString(responseText),
      });
    } else {
      logger.info("Scheduled-search Telegram message sent", notifyLog);
    }
  } catch (error) {
    logger.warn("Scheduled-search Telegram notification failed", {
      ...notifyLog,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Escape special characters for Telegram MarkdownV2. */
function escapeTelegramText(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Send all enabled notification channels for a completed scheduled search.
 * Never throws — all errors are contained and logged.
 */
export async function sendScheduledSearchNotifications(
  search: JobSearch,
  ctx: NotificationContext,
): Promise<void> {
  const notifyLog = {
    scheduleId: ctx.scheduleId,
    searchId: ctx.searchId,
    channel: "search-notifications",
  };

  if (ctx.resultsCount > 0 && search.status === "completed") {
    await sendEmailNotification(search, notifyLog);
  }

  await sendWebhookNotification(ctx, notifyLog);
  await sendTelegramNotification(ctx, notifyLog);
}