/**
 * MCP Stdio Transport (ADR-008).
 *
 * Implements newline-delimited JSON-RPC 2.0 framing over standard I/O (stdin/stdout).
 * Used when invoked by CLI AI agents (e.g. Claude Code, Cursor MCP, Codex).
 */

import * as readline from "node:readline";
import { McpServer } from "./server";
import type { McpJsonRpcRequest } from "./types";

export function startStdioTransport(server = new McpServer()): void {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on("line", async (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const request = JSON.parse(trimmed) as McpJsonRpcRequest;
      const response = await server.handleRequest(request);

      // Only send response if it has an id (notifications don't get responses)
      if (response.id !== null && response.id !== undefined) {
        process.stdout.write(`${JSON.stringify(response)}\n`);
      }
    } catch (_err) {
      const parseError = {
        jsonrpc: "2.0",
        id: null,
        error: {
          code: -32700,
          message: "Parse error",
        },
      };
      process.stdout.write(`${JSON.stringify(parseError)}\n`);
    }
  });

  process.on("SIGINT", () => {
    rl.close();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    rl.close();
    process.exit(0);
  });
}
