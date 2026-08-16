import { describe, expect, it } from "vitest";
import { McpServer } from "./server";
import type { McpJsonRpcRequest } from "./types";

describe("McpServer", () => {
  const server = new McpServer();

  it("handles initialize handshake per MCP spec", async () => {
    const req: McpJsonRpcRequest = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "test-client", version: "1.0.0" },
      },
    };

    const res = await server.handleRequest(req);
    expect(res.id).toBe(1);
    expect(res.error).toBeUndefined();
    expect(res.result).toEqual(
      expect.objectContaining({
        protocolVersion: "2024-11-05",
        serverInfo: { name: "job-ops-mcp", version: "0.4.0" },
      }),
    );
  });

  it("lists all available MCP tools", async () => {
    const req: McpJsonRpcRequest = {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    };

    const res = await server.handleRequest(req);
    expect(res.id).toBe(2);
    const tools = (res.result as { tools: Array<{ name: string }> }).tools;
    expect(tools.length).toBeGreaterThanOrEqual(6);
    expect(tools.some((t) => t.name === "search_jobs")).toBe(true);
    expect(tools.some((t) => t.name === "get_tracked_jobs")).toBe(true);
    expect(tools.some((t) => t.name === "import_search_jobs")).toBe(true);
  });

  it("lists and reads contextual resources", async () => {
    const listReq: McpJsonRpcRequest = {
      jsonrpc: "2.0",
      id: 3,
      method: "resources/list",
    };
    const listRes = await server.handleRequest(listReq);
    expect(listRes.id).toBe(3);
    const resources = (listRes.result as { resources: Array<{ uri: string }> })
      .resources;
    expect(resources.some((r) => r.uri === "jobops://settings")).toBe(true);

    const readReq: McpJsonRpcRequest = {
      jsonrpc: "2.0",
      id: 4,
      method: "resources/read",
      params: { uri: "jobops://settings" },
    };
    const readRes = await server.handleRequest(readReq);
    expect(readRes.id).toBe(4);
    expect(readRes.result).toHaveProperty("contents");
  });

  it("returns error on unknown tool call", async () => {
    const req: McpJsonRpcRequest = {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: { name: "unknown_dummy_tool" },
    };

    const res = await server.handleRequest(req);
    expect(res.id).toBe(5);
    expect(res.error).toBeDefined();
    expect(res.error?.code).toBe(-32601);
  });
});
