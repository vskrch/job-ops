/**
 * MCP SSE HTTP Transport (ADR-008).
 *
 * Implements the MCP HTTP Server-Sent Events transport spec.
 * - GET  /mcp/sse      — establishes SSE stream, emits endpoint event with message URI
 * - POST /mcp/messages — receives client JSON-RPC messages and routes responses back
 */

import { randomUUID } from "node:crypto";
import { setupSse, startSseHeartbeat, writeSseData } from "@infra/sse";
import { type Request, type Response, Router } from "express";
import { McpServer } from "./server";
import type { McpJsonRpcRequest } from "./types";

export const mcpSseRouter = Router();
const server = new McpServer();

interface SseSession {
  id: string;
  res: Response;
}

const activeSessions = new Map<string, SseSession>();

mcpSseRouter.get("/sse", (req: Request, res: Response) => {
  const sessionId = randomUUID();
  setupSse(res, { disableBuffering: true, flushHeaders: true });
  const stopHeartbeat = startSseHeartbeat(res);

  activeSessions.set(sessionId, { id: sessionId, res });

  // MCP spec: Send initial 'endpoint' event with URL for messages
  const messageEndpoint = `/mcp/messages?sessionId=${sessionId}`;
  res.write(`event: endpoint\ndata: ${messageEndpoint}\n\n`);

  req.on("close", () => {
    stopHeartbeat();
    activeSessions.delete(sessionId);
  });
});

mcpSseRouter.post("/messages", async (req: Request, res: Response) => {
  const sessionId = req.query.sessionId as string | undefined;
  if (!sessionId || !activeSessions.has(sessionId)) {
    res.status(404).json({ error: "Session not found or expired" });
    return;
  }

  const session = activeSessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found or expired" });
    return;
  }
  const request = req.body as McpJsonRpcRequest;

  // Acknowledge receipt
  res.status(202).send("Accepted");

  try {
    const response = await server.handleRequest(request);
    if (response.id !== null && response.id !== undefined) {
      writeSseData(session.res, response);
    }
  } catch (error) {
    writeSseData(session.res, {
      jsonrpc: "2.0",
      id: request.id ?? null,
      error: {
        code: -32603,
        message: error instanceof Error ? error.message : "Internal error",
      },
    });
  }
});
