/**
 * Browser Use backend for the crawl engine.
 *
 * Wraps the Browser Use sidecar (`browser-use/` Python FastAPI service) as a
 * CrawlEngine backend. When the direct, crawl4ai, and jina backends all fail
 * or are blocked by a CAPTCHA, this backend delegates to an LLM-driven agent
 * that can interact with the page like a human — clicking challenges,
 * scrolling, and extracting content.
 *
 * Never throws: every failure degrades to `{ ok: false, error }` so the
 * engine can report the final result.
 */

import {
  type BrowserTaskResult,
  type BrowserUseClient,
  createBrowserUseClient,
  getBrowserUseConfig,
} from "./browser-use-client.js";

export interface BrowserUseBackendResult {
  ok: boolean;
  text: string;
  contentType: string;
  statusCode: number;
  error?: string;
}

/** Create a client from env config; returns null when unconfigured. */
export function createBrowserUseBackend(): BrowserUseClient | null {
  const config = getBrowserUseConfig();
  if (!config) return null;
  return createBrowserUseClient(config);
}

/**
 * Fetch a URL via the Browser Use sidecar. The LLM agent is instructed to
 * navigate to the page, bypass any challenge, and return the page text.
 */
export async function browserUseFetch(
  client: BrowserUseClient,
  url: string,
  options?: { signal?: AbortSignal; requestId?: string; maxSteps?: number },
): Promise<BrowserUseBackendResult> {
  try {
    const task = `Navigate to this page and extract all the text content from the page body. If there is a CAPTCHA or challenge, try to solve it by clicking the checkbox or button. Return the full page text.`;

    const result: BrowserTaskResult = await client.runTask(
      {
        task,
        url,
        maxSteps: options?.maxSteps ?? 15,
        schema: {
          type: "object",
          properties: {
            text: { type: "string" },
            solved: { type: "boolean" },
          },
          required: ["text"],
        },
      },
      { signal: options?.signal, requestId: options?.requestId },
    );

    if (!result.success) {
      return {
        ok: false,
        text: "",
        contentType: "",
        statusCode: 0,
        error: result.error ?? "Browser Use task failed",
      };
    }

    const text = result.result?.text as string | undefined;

    if (!text) {
      return {
        ok: false,
        text: "",
        contentType: "",
        statusCode: 0,
        error: "Browser Use returned no page text",
      };
    }

    return {
      ok: true,
      text,
      contentType: "text/markdown",
      statusCode: 200,
    };
  } catch (error) {
    if (options?.signal?.aborted) {
      return {
        ok: false,
        text: "",
        contentType: "",
        statusCode: 0,
        error: "Aborted",
      };
    }
    return {
      ok: false,
      text: "",
      contentType: "",
      statusCode: 0,
      error:
        error instanceof Error ? error.message : "Browser Use request failed",
    };
  }
}
