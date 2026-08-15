#!/usr/bin/env node
/**
 * JobOps MCP Server CLI (ADR-008).
 *
 * Standalone stdio launcher for integrating JobOps with AI agents (Claude, Cursor, Codex).
 */

import { McpServer } from "./server";
import { startStdioTransport } from "./transport-stdio";

const server = new McpServer();
startStdioTransport(server);
