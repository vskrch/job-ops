/**
 * Minimal OpenAI-compatible chat client for extractor-side LLM work.
 *
 * Speaks the OpenAI Chat Completions API (`POST {base}/chat/completions`)
 * so any OpenAI-compatible endpoint works: OpenAI, OpenRouter, Groq,
 * Together, vLLM, Ollama, LM Studio, etc. Config comes from an explicit
 * `llm` argument (e.g. the app's UI-managed LLM settings) and falls back
 * to the orchestrator env vars:
 *
 *   LLM_BASE_URL   default https://api.openai.com/v1
 *   LLM_API_KEY    (optional for local servers like Ollama/LM Studio)
 *   LLM_MODEL      default gpt-4o-mini
 *
 * Payload policy (see AGENTS.md): only page text the extractor already
 * fetched is sent; no credentials, no cookies, no PII beyond the public
 * job posting content. Never throws: failures come back as
 * `{ success: false, error }` so callers fall back to regex parsing.
 */

const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const RETRYABLE_STATUS = [408, 429, 500, 502, 503, 504];

/** Explicit config wins over env; env wins over defaults. */
export interface LlmClientConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
}

export interface ChatMessage {
  role: "user" | "system" | "assistant";
  content: string;
}

export interface ChatJsonOptions {
  messages: ChatMessage[];
  model?: string;
  /** Ask for a JSON object response. Compatible servers may ignore it. */
  jsonMode?: boolean;
  /** How many attempts including the first (default 2). */
  maxRetries?: number;
  /** Base backoff ms, doubled per retry with jitter (default 1000). */
  baseBackoffMs?: number;
  /** Per-attempt timeout (default 60000). */
  timeoutMs?: number;
  signal?: AbortSignal;
  /** UI/settings-provided config; falls back to env vars. */
  llm?: LlmClientConfig;
}

export interface ChatJsonResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export function resolveLlmConfig(config?: LlmClientConfig): {
  baseUrl: string;
  apiKey: string | null;
  model: string;
} {
  const baseUrl = (
    config?.baseUrl?.trim() ||
    process.env.LLM_BASE_URL?.trim() ||
    DEFAULT_BASE_URL
  ).replace(/\/+$/, "");
  const apiKey =
    config?.apiKey?.trim() || process.env.LLM_API_KEY?.trim() || null;
  const model =
    config?.model?.trim() || process.env.LLM_MODEL?.trim() || DEFAULT_MODEL;
  return { baseUrl, apiKey, model };
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractContent(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first.message?.content;
  return typeof content === "string" && content.length > 0 ? content : null;
}

/** Strip markdown code fences around JSON. */
function unwrapJson(content: string): string {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)```$/);
  if (fenced) return fenced[1].trim();
  return trimmed;
}

export async function chatJson<T>(
  options: ChatJsonOptions,
): Promise<ChatJsonResult<T>> {
  const { baseUrl, apiKey, model } = resolveLlmConfig(options.llm);
  const maxRetries = Math.max(1, options.maxRetries ?? 2);
  const baseBackoffMs = options.baseBackoffMs ?? 1000;
  const timeoutMs = options.timeoutMs ?? 60_000;

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const timeoutSignal =
        timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
      const signal =
        options.signal && timeoutSignal
          ? AbortSignal.any([options.signal, timeoutSignal])
          : (options.signal ?? timeoutSignal ?? undefined);

      const headers: Record<string, string> = {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      };

      const body: Record<string, unknown> = {
        model,
        messages: options.messages,
        temperature: 0,
      };
      if (options.jsonMode) {
        body.response_format = { type: "json_object" };
      }

      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal,
      });

      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        const status = response.status;
        if (!RETRYABLE_STATUS.includes(status) || attempt >= maxRetries) {
          return {
            success: false,
            error: `LLM API error: ${status}${detail ? `: ${detail}` : ""}`,
          };
        }
      } else {
        const content = extractContent(await response.json());
        if (!content) {
          if (attempt >= maxRetries) {
            return { success: false, error: "LLM returned no content" };
          }
        } else {
          const parsed = parseStructured<T>(unwrapJson(content));
          if (parsed.ok) return { success: true, data: parsed.data };
          if (attempt >= maxRetries) {
            return { success: false, error: "LLM returned invalid JSON" };
          }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt >= maxRetries) {
        return { success: false, error: `LLM request failed: ${message}` };
      }
    }

    const backoff = baseBackoffMs * 2 ** (attempt - 1);
    await sleep(Math.floor(backoff * Math.random()));
  }

  return { success: false, error: "All LLM attempts failed" };
}

function parseStructured<T>(
  content: string,
): { ok: true; data: T } | { ok: false } {
  try {
    const value = JSON.parse(content) as unknown;
    // Providers often wrap the array in an object like {"jobs": [...]}.
    if (Array.isArray(value)) return { ok: true, data: value as T };
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const record = value as Record<string, unknown>;
      if (Array.isArray(record.jobs))
        return { ok: true, data: record.jobs as T };
    }
    return { ok: true, data: value as T };
  } catch {
    return { ok: false };
  }
}
