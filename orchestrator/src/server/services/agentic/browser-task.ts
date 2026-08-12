import { logger } from "@infra/logger";
import { getRequestId } from "@infra/request-context";
import { sanitizeUnknown } from "@infra/sanitize";
import {
  type BrowserTaskResult,
  createBrowserUseClient,
  getBrowserUseConfig,
} from "@shared/crawl/browser-use-client.js";
import type { AppSettings } from "@shared/types";

export interface RunBrowserTaskInput {
  task: string;
  url?: string;
  maxSteps?: number;
}

export interface RunBrowserTaskOutput {
  success: boolean;
  result: Record<string, unknown> | null;
  steps: number;
  error?: string;
  disabled?: boolean;
}

const MAX_TASK_LENGTH = 8000;

export function isBrowserAgentEnabled(settings: AppSettings): boolean {
  return settings.browserAgentEnabled?.value === true;
}

export function isBrowserAutoApplyEnabled(settings: AppSettings): boolean {
  return settings.browserAutoApplyEnabled?.value === true;
}

export function browserTaskBudget(settings: AppSettings): {
  maxSteps: number;
  timeoutMs: number;
  maxCost: number;
} {
  return {
    maxSteps: Number(settings.browserAgentMaxSteps?.value ?? 10),
    timeoutMs: Number(settings.browserAgentTimeoutMs?.value ?? 60_000),
    maxCost: Number(settings.browserAgentMaxCost?.value ?? 0.1),
  };
}

/**
 * Execute an interactive browser task via the Browser Use sidecar.
 * Gated by the `browserAgentEnabled` setting — when disabled or when the
 * sidecar is unreachable, returns a graceful failure (lights-on contract).
 */
export async function runBrowserTask(
  input: RunBrowserTaskInput,
  settings: AppSettings,
): Promise<RunBrowserTaskOutput> {
  if (!isBrowserAgentEnabled(settings)) {
    return { success: false, result: null, steps: 0, disabled: true };
  }

  const config = getBrowserUseConfig();
  if (!config) {
    logger.warn("Browser agent enabled but BROWSER_USE_BASE_URL is not set");
    return {
      success: false,
      result: null,
      steps: 0,
      error: "Browser agent is not configured (BROWSER_USE_BASE_URL unset)",
    };
  }

  const task = input.task?.trim() ?? "";
  if (!task) {
    return { success: false, result: null, steps: 0, error: "Task is empty" };
  }
  if (task.length > MAX_TASK_LENGTH) {
    return {
      success: false,
      result: null,
      steps: 0,
      error: `Task exceeds ${MAX_TASK_LENGTH} characters`,
    };
  }

  const budget = browserTaskBudget(settings);
  const maxSteps = Math.min(input.maxSteps ?? budget.maxSteps, budget.maxSteps);

  const client = createBrowserUseClient({
    baseUrl: config.baseUrl,
    timeoutMs: budget.timeoutMs,
    apiToken: config.apiToken,
  });

  try {
    const result: BrowserTaskResult = await client.runTask(
      { task, url: input.url, maxSteps },
      { requestId: getRequestId() },
    );

    logger.info("Browser task executed", {
      success: result.success,
      steps: result.steps,
      requestId: getRequestId(),
    });

    return {
      success: result.success,
      result: result.result,
      steps: result.steps,
      ...(result.error ? { error: result.error } : {}),
    };
  } catch (error) {
    logger.error("Browser task failed", {
      error: sanitizeUnknown(error),
      requestId: getRequestId(),
    });
    return {
      success: false,
      result: null,
      steps: 0,
      error: error instanceof Error ? error.message : "Browser task failed",
    };
  }
}
