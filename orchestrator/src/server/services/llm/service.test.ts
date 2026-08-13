import { afterEach, describe, expect, it, vi } from "vitest";
import { LlmService } from "./service";

describe("LlmService provider normalization", () => {
  it("keeps legacy localhost openai_compatible configs on LM Studio", () => {
    const llm = new LlmService({
      provider: "openai_compatible",
      baseUrl: "http://localhost:1234",
    });

    expect(llm.getProvider()).toBe("lmstudio");
    expect(llm.getBaseUrl()).toBe("http://localhost:1234");
  });

  it("uses the dedicated provider for non-local OpenAI-compatible endpoints", () => {
    const llm = new LlmService({
      provider: "openai_compatible",
      baseUrl: "https://llm.example.com",
    });

    expect(llm.getProvider()).toBe("openai_compatible");
    expect(llm.getBaseUrl()).toBe("https://llm.example.com");
  });

  it("normalizes the hyphenated openai-compatible alias", () => {
    const llm = new LlmService({
      provider: "openai-compatible",
      baseUrl: "https://llm.example.com",
    });

    expect(llm.getProvider()).toBe("openai_compatible");
    expect(llm.getBaseUrl()).toBe("https://llm.example.com");
  });
});

describe("LlmService retries", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function jsonResponse(content: string): Response {
    return new Response(
      JSON.stringify({
        output: [
          { type: "message", content: [{ type: "output_text", text: content }] },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  it("gives each attempt a fresh timeout instead of reusing an expired signal", async () => {
    const fetchMock = vi.fn(
      async (_url: string, init?: { signal?: AbortSignal }) => {
        if (fetchMock.mock.calls.length === 1) {
          await new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () =>
              reject(new DOMException("The operation was aborted due to timeout", "AbortError")),
            );
          });
        }
        return jsonResponse('{"ok":true}');
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    void originalFetch;

    const llm = new LlmService({
      provider: "openai",
      apiKey: "test-key",
      baseUrl: "https://api.openai.com/v1",
    });

    const result = await llm.callJson({
      model: "test-model",
      messages: [{ role: "user", content: "hi" }],
      jsonSchema: { name: "test", schema: { type: "object" } },
      maxRetries: 1,
      retryDelayMs: 0,
      timeoutMs: 150,
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
