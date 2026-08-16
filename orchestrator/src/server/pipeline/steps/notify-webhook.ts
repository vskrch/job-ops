import { sanitizeWebhookPayload } from "@infra/sanitize";
import { postWebhook } from "@infra/webhook";
import * as settingsRepo from "@server/repositories/settings";

export async function notifyPipelineWebhookStep(
  event: "pipeline.completed" | "pipeline.failed" | "pipeline.cancelled",
  payload: Record<string, unknown>,
): Promise<void> {
  const overridePipelineWebhookUrl =
    await settingsRepo.getSetting("pipelineWebhookUrl");
  const pipelineWebhookUrl = (
    overridePipelineWebhookUrl ||
    process.env.PIPELINE_WEBHOOK_URL ||
    process.env.WEBHOOK_URL ||
    ""
  ).trim();

  if (!pipelineWebhookUrl) return;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = process.env.WEBHOOK_SECRET;
  if (secret) headers.Authorization = `Bearer ${secret}`;

  const sanitizedPayload = sanitizeWebhookPayload({
    event,
    sentAt: new Date().toISOString(),
    pipelineRunId: payload.pipelineRunId,
    jobsDiscovered: payload.jobsDiscovered,
    jobsScored: payload.jobsScored,
    jobsProcessed: payload.jobsProcessed,
    error: payload.error,
  });

  await postWebhook(
    pipelineWebhookUrl,
    sanitizedPayload,
    headers,
    { event },
    "Pipeline webhook",
  );
}
