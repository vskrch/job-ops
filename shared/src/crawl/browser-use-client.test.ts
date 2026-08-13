import { afterEach, describe, expect, it, vi } from "vitest";
import { createBrowserUseClient } from "./browser-use-client";

const originalFetch = globalThis.fetch;

function mockFetchImpl(
  responses: Array<{ ok: boolean; status: number; body: unknown }>,
) {
  let callIndex = 0;
  const fn = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) => {
      const mock = responses[callIndex] ?? responses[responses.length - 1];
      callIndex += 1;
      return {
        ok: mock.ok,
        status: mock.status,
        json: async () => mock.body,
        text: async () =>
          typeof mock.body === "string" ? mock.body : JSON.stringify(mock.body),
      } as Response;
    },
  );
  globalThis.fetch = fn as unknown as typeof globalThis.fetch;
  return fn;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("BrowserUseClient", () => {
  it("runTask returns success when the server responds ok", async () => {
    mockFetchImpl([
      {
        ok: true,
        status: 200,
        body: {
          success: true,
          result: { title: "Example" },
          screenshots: ["base64..."],
          steps: 3,
        },
      },
    ]);
    const client = createBrowserUseClient({ baseUrl: "http://localhost:8000" });
    const result = await client.runTask({ task: "Go to example.com" });
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ title: "Example" });
    expect(result.steps).toBe(3);
  });

  it("runTask returns error when the server responds with an error status", async () => {
    mockFetchImpl([{ ok: false, status: 503, body: "Service Unavailable" }]);
    const client = createBrowserUseClient({ baseUrl: "http://localhost:8000" });
    const result = await client.runTask({ task: "Go to example.com" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("503");
  });

  it("runTask returns error on network failure", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const client = createBrowserUseClient({ baseUrl: "http://localhost:8000" });
    const result = await client.runTask({ task: "Go to example.com" });
    expect(result.success).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("health returns true when the server is healthy", async () => {
    mockFetchImpl([{ ok: true, status: 200, body: { status: "ok" } }]);
    const client = createBrowserUseClient({ baseUrl: "http://localhost:8000" });
    const healthy = await client.health();
    expect(healthy).toBe(true);
  });

  it("health returns false on network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("Connection refused");
    }) as unknown as typeof globalThis.fetch;
    const client = createBrowserUseClient({ baseUrl: "http://localhost:8000" });
    const healthy = await client.health();
    expect(healthy).toBe(false);
  });
});
