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
            ...(request.maxSteps ? { maxSteps: request.maxSteps } : {}),
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

        const data = (await response.json()) as BrowserTaskResult;
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
