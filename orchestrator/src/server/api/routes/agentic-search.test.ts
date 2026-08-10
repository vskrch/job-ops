import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

vi.mock("@server/services/agentic", () => ({
  startAgenticSearch: vi.fn(),
  cancelAgenticSearch: vi.fn(),
  isAgenticSearchEnabled: vi.fn(async () => true),
  subscribeToAgenticSearchProgress: vi.fn(() => () => {}),
}));

import {
  cancelAgenticSearch,
  startAgenticSearch,
} from "@server/services/agentic";

const mockStartAgenticSearch = vi.mocked(startAgenticSearch);
const mockCancelAgenticSearch = vi.mocked(cancelAgenticSearch);

describe("Agentic search API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
    mockStartAgenticSearch.mockReset();
    mockCancelAgenticSearch.mockReset();
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("rejects a missing query with 400 INVALID_REQUEST", async () => {
    const res = await fetch(`${baseUrl}/api/agentic-searches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(mockStartAgenticSearch).not.toHaveBeenCalled();
  });

  it("rejects creation when the feature flag is disabled", async () => {
    const { isAgenticSearchEnabled } = await import("@server/services/agentic");
    vi.mocked(isAgenticSearchEnabled).mockResolvedValueOnce(false);

    const res = await fetch(`${baseUrl}/api/agentic-searches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Data Engineer in London" }),
    });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("INVALID_REQUEST");
    expect(mockStartAgenticSearch).not.toHaveBeenCalled();
  });

  it("creates an agentic search and returns the search id", async () => {
    mockStartAgenticSearch.mockResolvedValue({
      id: "agentic-test-1",
      status: "planning",
    } as never);

    const res = await fetch(`${baseUrl}/api/agentic-searches`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Data Engineer in London" }),
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.data.searchId).toBe("agentic-test-1");
    expect(body.data.status).toBe("planning");
    expect(body.meta.requestId).toBeTruthy();
    expect(mockStartAgenticSearch).toHaveBeenCalledWith(
      "Data Engineer in London",
    );
  });

  it("lists agentic searches", async () => {
    const res = await fetch(`${baseUrl}/api/agentic-searches?limit=5`);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data.searches)).toBe(true);
  });

  it("returns 404 for an unknown search id", async () => {
    const res = await fetch(`${baseUrl}/api/agentic-searches/does-not-exist`);
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 when cancelling an unknown search id", async () => {
    mockCancelAgenticSearch.mockResolvedValue(null);

    const res = await fetch(
      `${baseUrl}/api/agentic-searches/does-not-exist/cancel`,
      { method: "POST" },
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 for the SSE stream of an unknown search id", async () => {
    const res = await fetch(
      `${baseUrl}/api/agentic-searches/does-not-exist/progress`,
    );
    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("NOT_FOUND");
  });
});
