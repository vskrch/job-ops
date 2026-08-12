export interface BrowserTaskRequest {
  task: string;
  url?: string;
  maxSteps?: number;
  schema?: Record<string, unknown>;
}

export interface BrowserTaskResult {
  success: boolean;
  result: Record<string, unknown> | null;
  screenshots: string[];
  steps: number;
  error?: string;
}

export interface BrowserUseClient {
  runTask(
    request: BrowserTaskRequest,
    options?: { signal?: AbortSignal },
  ): Promise<BrowserTaskResult>;
  health(): Promise<boolean>;
}

export interface BrowserUseConfig {
  baseUrl: string;
  timeoutMs?: number;
}

export function createBrowserUseClient(
  config: BrowserUseConfig,
): BrowserUseClient {
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const timeoutMs = config.timeoutMs ?? 60_000;

  return {
    async runTask(
      request: BrowserTaskRequest,
      options?: { signal?: AbortSignal },
    ): Promise<BrowserTaskResult> {
      const signal = options?.signal ?? AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetch(`${baseUrl}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: request.task,
            ...(request.url ? { url: request.url } : {}),
            ...(request.maxSteps !== undefined
              ? { maxSteps: request.maxSteps }
              : {}),
            ...(request.schema ? { schema: request.schema } : {}),
          }),
          signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          return {
            success: false,
            result: null,
            screenshots: [],
            steps: 0,
            error: `Browser Use returned ${response.status}: ${text.slice(0, 200)}`,
          };
        }

        const raw = (await response.json()) as Record<string, unknown>;
        const data: BrowserTaskResult = {
          success: raw.success === true,
          result:
            raw.result && typeof raw.result === "object"
              ? (raw.result as Record<string, unknown>)
              : null,
          screenshots: Array.isArray(raw.screenshots)
            ? (raw.screenshots as string[])
            : [],
          steps:
            typeof raw.steps === "number" && Number.isFinite(raw.steps)
              ? raw.steps
              : 0,
          ...(typeof raw.error === "string" ? { error: raw.error } : {}),
        };
        return data;
      } catch (error) {
        return {
          success: false,
          result: null,
          screenshots: [],
          steps: 0,
          error:
            error instanceof Error
              ? error.message
              : "Browser Use request failed",
        };
      }
    },

    async health(): Promise<boolean> {
      try {
        const response = await fetch(`${baseUrl}/health`, {
          signal: AbortSignal.timeout(5000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}

export function getBrowserUseConfig(): BrowserUseConfig | null {
  const baseUrl = process.env.BROWSER_USE_BASE_URL?.trim();
  if (!baseUrl) return null;
  return { baseUrl };
}
