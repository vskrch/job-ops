/**
 * Email delivery service for job search results.
 *
 * Uses nodemailer over SMTP. SMTP config comes from env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
 *
 * Failures are caught and logged — they never fail the search itself.
 * For large results, the email is truncated to top 20 jobs with a link
 * back to the application's results page.
 */

import { logger } from "@infra/logger";
import type { JobSearch } from "@shared/types";
import { getUserById } from "./auth";

const MAX_JOBS_IN_EMAIL = 20;

interface SmtpConfig {
  host: string;
  port: number;
  user: string | null;
  password: string | null;
  from: string;
}

function getSmtpConfig(): SmtpConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) return null;
  const port = Number.parseInt(process.env.SMTP_PORT ?? "587", 10) || 587;
  return {
    host,
    port,
    user: process.env.SMTP_USER?.trim() || null,
    password: process.env.SMTP_PASSWORD?.trim() || null,
    from: process.env.SMTP_FROM?.trim() || "jobops@localhost",
  };
}

export function isEmailConfigured(): boolean {
  return getSmtpConfig() !== null;
}

async function getRecipientEmail(): Promise<string | null> {
  const { getCurrentUserId } = await import("@infra/request-context");
  const userId = getCurrentUserId();
  if (!userId || userId === "default-user") {
    return process.env.SMTP_DEFAULT_RECIPIENT?.trim() || null;
  }
  const user = await getUserById(userId);
  return user?.email ?? null;
}

function renderSearchEmail(
  search: JobSearch,
  publicBaseUrl: string,
): { subject: string; html: string; text: string } {
  const spec = search.parsedSpec;
  const results = search.results;

  const subject = `Job Search Results: ${spec?.roles.join(", ") ?? search.originalQuery.slice(0, 50)}`;

  const jobs = results?.jobs ?? [];
  const displayedJobs = jobs.slice(0, MAX_JOBS_IN_EMAIL);
  const truncated = jobs.length > MAX_JOBS_IN_EMAIL;

  const sourceSummary = (results?.sources ?? [])
    .map(
      (s) =>
        `${s.source}: ${s.status} (${s.jobsFound} jobs${s.error ? `, error: ${s.error}` : ""})`,
    )
    .join("\n");

  const textParts: string[] = [
    `Job Search Results`,
    ``,
    `Query: ${search.originalQuery}`,
    `Search ID: ${search.id}`,
    `Search completed: ${search.searchCompletedAt ?? "N/A"}`,
    ``,
    `Interpreted criteria:`,
    spec?.interpretation ?? "N/A",
    ``,
    `Summary:`,
    `  Total discovered: ${results?.totalDiscovered ?? 0}`,
    `  After filtering: ${results?.totalAfterFilter ?? 0}`,
    `  Duplicates removed: ${results?.duplicatesRemoved ?? 0}`,
    `  Highly relevant: ${results?.highlyRelevant ?? 0}`,
    ``,
    `Sources:`,
    sourceSummary || "None",
    ``,
    `Freshness window: ${results?.freshness.requested ?? "any"}`,
    `  Effective: ${results?.freshness.effectiveStart ?? "N/A"} to ${results?.freshness.effectiveEnd ?? "N/A"}`,
    `  Removed by freshness: ${results?.freshness.removedByFreshness ?? 0}`,
    ``,
    `Top ${displayedJobs.length} jobs:`,
    ...displayedJobs.map(
      (item, i) =>
        `\n${i + 1}. ${item.job.title} at ${item.job.employer}\n   Location: ${item.job.location ?? "N/A"}\n   Relevance: ${item.relevanceScore}/100\n   ${item.matchExplanation}\n   URL: ${item.job.applicationLink ?? item.job.jobUrl}\n   Sources: ${item.sources.join(", ")}`,
    ),
    truncated
      ? `\n...and ${jobs.length - MAX_JOBS_IN_EMAIL} more. See full results at ${publicBaseUrl}/job-search/${search.id}`
      : "",
    ``,
    `View full results: ${publicBaseUrl}/job-search/${search.id}`,
  ];

  const htmlParts: string[] = [
    `<div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 800px;">`,
    `<h1>Job Search Results</h1>`,
    `<p><strong>Query:</strong> ${escapeHtml(search.originalQuery)}</p>`,
    `<p><strong>Search ID:</strong> ${escapeHtml(search.id)}</p>`,
    `<p><strong>Completed:</strong> ${search.searchCompletedAt ?? "N/A"}</p>`,
    `<h2>Interpreted Criteria</h2>`,
    `<p>${escapeHtml(spec?.interpretation ?? "N/A")}</p>`,
    `<h2>Summary</h2>`,
    `<ul>`,
    `<li>Total discovered: ${results?.totalDiscovered ?? 0}</li>`,
    `<li>After filtering: ${results?.totalAfterFilter ?? 0}</li>`,
    `<li>Duplicates removed: ${results?.duplicatesRemoved ?? 0}</li>`,
    `<li>Highly relevant: ${results?.highlyRelevant ?? 0}</li>`,
    `</ul>`,
    `<h2>Sources</h2>`,
    `<ul>${(results?.sources ?? [])
      .map(
        (s) =>
          `<li><strong>${escapeHtml(s.source)}</strong>: ${escapeHtml(s.status)} (${s.jobsFound} jobs${s.error ? `, error: ${escapeHtml(s.error)}` : ""})</li>`,
      )
      .join("")}</ul>`,
    `<h2>Freshness Window</h2>`,
    `<p>Requested: ${escapeHtml(results?.freshness.requested ?? "any")}<br>Effective: ${escapeHtml(results?.freshness.effectiveStart ?? "N/A")} to ${escapeHtml(results?.freshness.effectiveEnd ?? "N/A")}<br>Removed by freshness: ${results?.freshness.removedByFreshness ?? 0}</p>`,
    `<h2>Top ${displayedJobs.length} Jobs</h2>`,
    ...displayedJobs.map(
      (item, i) => `
      <div style="border: 1px solid #e0e0e0; padding: 12px; margin: 8px 0; border-radius: 8px;">
        <h3 style="margin: 0 0 4px 0;">${i + 1}. ${escapeHtml(item.job.title)}</h3>
        <p style="margin: 0 0 4px 0;"><strong>${escapeHtml(item.job.employer)}</strong> — ${escapeHtml(item.job.location ?? "Location not specified")}</p>
        <p style="margin: 0 0 4px 0; color: #666;">Relevance: <strong>${item.relevanceScore}/100</strong> | Sources: ${item.sources.map((s) => escapeHtml(s)).join(", ")}</p>
        <p style="margin: 0 0 8px 0; font-size: 14px;">${escapeHtml(item.matchExplanation)}</p>
        <p style="margin: 0; font-size: 14px;">Verified: ${item.verifiedConstraints.map((c) => escapeHtml(c)).join(", ") || "none"} | Unverified: ${item.unverifiedConstraints.map((c) => escapeHtml(c)).join(", ") || "none"}</p>
        ${item.job.applicationLink || item.job.jobUrl ? `<p style="margin: 8px 0 0 0;"><a href="${safeUrl(item.job.applicationLink ?? item.job.jobUrl)}" style="color: #2563eb;">View Job Posting →</a></p>` : ""}
      </div>`,
    ),
    truncated
      ? `<p>...and ${jobs.length - MAX_JOBS_IN_EMAIL} more. <a href="${escapeHtml(`${publicBaseUrl}/job-search/${search.id}`)}">View full results →</a></p>`
      : "",
    `<hr style="margin: 24px 0;">`,
    `<p style="font-size: 14px; color: #666;"><a href="${safeUrl(`${publicBaseUrl}/job-search/${search.id}`)}">View full results in Job Ops →</a></p>`,
    `</div>`,
  ];

  return {
    subject,
    text: textParts.join("\n"),
    html: htmlParts.join("\n"),
  };
}

function escapeHtml(str: string | null | undefined): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeUrl(url: string | null | undefined): string {
  if (!url) return "";
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return escapeHtml(trimmed);
  return "";
}

/**
 * Send the search results email to the user's configured email address.
 * Returns success/failure — never throws so the search is not affected.
 */
export async function sendSearchResultsEmail(
  search: JobSearch,
  publicBaseUrl: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const config = getSmtpConfig();
    if (!config) {
      logger.info("SMTP not configured, skipping email", {
        searchId: search.id,
      });
      return { success: false, error: "SMTP not configured" };
    }

    const recipient = await getRecipientEmail();
    if (!recipient) {
      logger.warn("No recipient email found for search", {
        searchId: search.id,
      });
      return { success: false, error: "No recipient email available" };
    }

    const { default: nodemailer } = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user
        ? { user: config.user, pass: config.password ?? undefined }
        : undefined,
    });

    const { subject, html, text } = renderSearchEmail(search, publicBaseUrl);

    const info = await transporter.sendMail({
      from: config.from,
      to: recipient,
      subject,
      text,
      html,
    });

    logger.info("Job search email sent", {
      searchId: search.id,
      recipient: recipient.replace(/(.{2}).*(@.*)/, "$1***$2"),
      messageId: info.messageId,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to send search results email", {
      searchId: search.id,
      error: message,
    });
    return { success: false, error: message };
  }
}

/**
 * Send a password reset email with the secure token link.
 */
export async function sendPasswordResetEmail(
  recipient: string,
  resetUrl: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const config = getSmtpConfig();
    if (!config) {
      logger.info("SMTP not configured, password reset email skipped", {
        recipient: recipient.replace(/(.{2}).*(@.*)/, "$1***$2"),
      });
      return { success: false, error: "SMTP not configured" };
    }

    const { default: nodemailer } = await import("nodemailer");
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.port === 465,
      auth: config.user
        ? { user: config.user, pass: config.password ?? undefined }
        : undefined,
    });

    const subject = "Reset Your JobOps Password";
    const text = `You requested a password reset for your JobOps account.\n\nPlease click the link below to set a new password:\n${resetUrl}\n\nThis link is valid for 1 hour. If you did not request this, you can safely ignore this email.`;
    const html = `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #1e293b;">
        <h2 style="margin-top: 0; color: #0f172a;">Reset Your JobOps Password</h2>
        <p>You recently requested to reset your password for your JobOps account.</p>
        <div style="margin: 28px 0;">
          <a href="${escapeHtml(resetUrl)}" style="background-color: #2563eb; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 500; display: inline-block;">Reset Password</a>
        </div>
        <p style="font-size: 14px; color: #64748b;">Or copy and paste this link in your browser:</p>
        <p style="font-size: 13px; word-break: break-all; color: #2563eb;">${escapeHtml(resetUrl)}</p>
        <hr style="border: 0; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
        <p style="font-size: 12px; color: #94a3b8; margin-bottom: 0;">This link is valid for 1 hour. If you did not request this password reset, please ignore this email.</p>
      </div>
    `;

    const info = await transporter.sendMail({
      from: config.from,
      to: recipient,
      subject,
      text,
      html,
    });

    logger.info("Password reset email sent", {
      recipient: recipient.replace(/(.{2}).*(@.*)/, "$1***$2"),
      messageId: info.messageId,
    });

    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error("Failed to send password reset email", { error: message });
    return { success: false, error: message };
  }
}
