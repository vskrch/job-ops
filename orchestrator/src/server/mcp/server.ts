/**
 * Model Context Protocol (MCP) Server (ADR-008).
 *
 * Implements the MCP 2024-11-05 standard over JSON-RPC 2.0.
 * Coordinates tools, resources, handshakes, and execution safety.
 */

import { logger } from "@infra/logger";
import { MCP_RESOURCES, readMcpResource } from "./resources";
import {
  crawlAndExtractJobTool,
  getTrackedJobsTool,
  handleCrawlAndExtractJob,
  handleGetTrackedJobs,
  handleImportSearchJobs,
  importSearchJobsTool,
} from "./tools/jobs";
import { getSystemStatusTool, handleGetSystemStatus } from "./tools/pipeline";
import {
  getSearchStatusTool,
  handleGetSearchStatus,
  handleListRecentSearches,
  handleSearchJobs,
  listRecentSearchesTool,
  searchJobsTool,
} from "./tools/search";
import type {
  McpJsonRpcRequest,
  McpJsonRpcResponse,
  McpTool,
  McpToolHandler,
} from "./types";

export class McpServer {
  private readonly tools = new Map<
    string,
    { tool: McpTool; handler: McpToolHandler }
  >();

  constructor() {
    this.registerTool(searchJobsTool, handleSearchJobs);
    this.registerTool(getSearchStatusTool, handleGetSearchStatus);
    this.registerTool(listRecentSearchesTool, handleListRecentSearches);
    this.registerTool(getTrackedJobsTool, handleGetTrackedJobs);
    this.registerTool(importSearchJobsTool, handleImportSearchJobs);
    this.registerTool(crawlAndExtractJobTool, handleCrawlAndExtractJob);
    this.registerTool(getSystemStatusTool, handleGetSystemStatus);
  }

  public registerTool(tool: McpTool, handler: McpToolHandler): void {
    this.tools.set(tool.name, { tool, handler });
  }

  public async handleRequest(
    request: McpJsonRpcRequest,
  ): Promise<McpJsonRpcResponse> {
    const { id, method, params } = request;

    try {
      switch (method) {
        case "initialize": {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              protocolVersion: "2024-11-05",
              capabilities: {
                tools: {},
                resources: {},
              },
              serverInfo: {
                name: "job-ops-mcp",
                version: "0.3.0",
              },
            },
          };
        }

        case "notifications/initialized": {
          // Client acknowledgement
          return {
            jsonrpc: "2.0",
            id: null,
            result: {},
          };
        }

        case "ping": {
          return {
            jsonrpc: "2.0",
            id,
            result: {},
          };
        }

        case "tools/list": {
          const toolList: McpTool[] = Array.from(this.tools.values()).map(
            (t) => t.tool,
          );
          return {
            jsonrpc: "2.0",
            id,
            result: {
              tools: toolList,
            },
          };
        }

        case "tools/call": {
          const toolName = params?.name as string | undefined;
          const toolArgs = (params?.arguments as Record<string, unknown>) || {};

          if (!toolName || !this.tools.has(toolName)) {
            return {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32601,
                message: `Unknown tool: ${toolName}`,
              },
            };
          }

          const entry = this.tools.get(toolName);
          if (!entry) {
            return {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32601,
                message: `Unknown tool: ${toolName}`,
              },
            };
          }
          const result = await entry.handler(toolArgs);

          return {
            jsonrpc: "2.0",
            id,
            result,
          };
        }

        case "resources/list": {
          return {
            jsonrpc: "2.0",
            id,
            result: {
              resources: MCP_RESOURCES,
            },
          };
        }

        case "resources/read": {
          const uri = params?.uri as string | undefined;
          if (!uri) {
            return {
              jsonrpc: "2.0",
              id,
              error: {
                code: -32602,
                message: "Missing required parameter: uri",
              },
            };
          }

          const content = await readMcpResource(uri);
          return {
            jsonrpc: "2.0",
            id,
            result: {
              contents: [content],
            },
          };
        }

        default:
          return {
            jsonrpc: "2.0",
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Internal error";
      logger.error("MCP Server request error", { method, error });
      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32603,
          message,
        },
      };
    }
  }
}
