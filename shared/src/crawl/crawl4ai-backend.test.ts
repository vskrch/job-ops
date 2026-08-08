import { afterEach, describe, expect, it, vi } from "vitest";
import { type Crawl4AIConfig, crawl4aiFetch } from "./crawl4ai-backend";

const CONFIG: Crawl4AIConfig = {
  baseUrl: "http://crawl4ai:11235",
  timeoutMs: 5000,
};

function jsonRes(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("crawl4aiFetch", () => {
  it("returns markdown from a synchronous response with inline results", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes({
        results: [
          {
            markdown: "# Senior Engineer\nApply now.",
            html: "<html></html>",
            fit_markdown: "# Senior Engineer",
            status_code: 200,
          },
        ],
      }) as Response,
    );

    const result = await crawl4aiFetch("https://example.com/jobs/1", CONFIG);

    expect(result.ok).toBe(true);
    expect(result.markdown).toBe("# Senior Engineer\nApply now.");
    expect(result.fitMarkdown).toBe("# Senior Engineer");
    expect(result.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles markdown returned as an object with raw_markdown", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonRes({
        results: [
          {
            markdown: { raw_markdown: "# raw markdown", fit_markdown: "# fit" },
            html: "<html></html>",
            status_code: 200,
          },
        ],
      }) as Response,
    );

    const result = await crawl4aiFetch("https://example.com/jobs/1", CONFIG);

    expect(result.ok).toBe(true);
    expect(result.markdown).toBe("# raw markdown");
    expect(result.fitMarkdown).toBe("# fit");
  });

  it("polls the task endpoint for an async (task_id) response", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      callCount += 1;
      const url = String(input);
      if (url.endsWith("/crawl")) {
        return jsonRes({ task_id: "task-123" }) as Response;
      }
      // First poll: pending (no results). Second poll: results.
      if (url.endsWith("/task/task-123")) {
        if (callCount === 2) {
          return jsonRes({
            results: [{ markdown: "# polled job", status_code: 200 }],
          }) as Response;
        }
        return jsonRes({}) as Response;
      }
      return jsonRes({}) as Response;
    });

    const result = await crawl4aiFetch("https://example.com/jobs/1", {
      ...CONFIG,
      timeoutMs: 0, // disable timeout so polling controls cadence
    });

    expect(result.ok).toBe(true);
    expect(result.markdown).toBe("# polled job");
  });

  it("returns ok: false on a non-200 crawl response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("upstream error", { status: 502 }),
    );

    const result = await crawl4aiFetch("https://example.com/jobs/1", CONFIG);

    expect(result.ok).toBe(false);
    expect(result.statusCode).toBe(0);
    expect(result.error).toContain("502");
  });

  it("returns ok: false on a network error without throwing", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await crawl4aiFetch("https://example.com/jobs/1", {
      ...CONFIG,
      timeoutMs: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("sends the Authorization header when an apiToken is configured", async () => {
    let receivedHeaders: Headers | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      receivedHeaders = new Headers(init?.headers as Record<string, string>);
      return jsonRes({
        results: [{ markdown: "# ok", status_code: 200 }],
      }) as Response;
    });

    await crawl4aiFetch("https://example.com/jobs/1", {
      ...CONFIG,
      apiToken: "secret-token",
    });

    expect(receivedHeaders?.get("authorization")).toBe("Bearer secret-token");
  });
});
