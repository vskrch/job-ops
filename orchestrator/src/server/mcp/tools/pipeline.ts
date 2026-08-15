/**
 * MCP Pipeline & System Tools (ADR-008).
 *
 * Exposes pipeline automation and system diagnostics.
 */

import { getExtractorRegistry } from "@server/extractors/registry";
import * as jobsRepo from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import { getAvailableMetaAdapters } from "@server/services/job-search/meta-search";
import type { McpTool, McpToolHandler } from "../types";

export const getSystemStatusTool: McpTool = {
  name: "get_system_status",
  description:
    "Check status of available job search extractors, free meta-search adapters, and database counts.",
  inputSchema: {
    type: "object",
    properties: {},
  },
};

export const handleGetSystemStatus: McpToolHandler = async () => {
  const [registry, metaAdapters, jobStats, settings] = await Promise.all([
    getExtractorRegistry(),
    getAvailableMetaAdapters(),
    jobsRepo.getJobStats(),
    settingsRepo.getAllSettings(),
  ]);

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            activeExtractorsCount: registry.manifests.size,
            registeredExtractors: Array.from(registry.manifests.keys()),
            metaSearchAdapters: metaAdapters.map((a) => ({
              id: a.id,
              name: a.displayName,
            })),
            jobCountsByStatus: jobStats,
            configuredLlmModel: settings.model || "default",
            mcpEnabled: settings.mcpEnabled === "1",
            freeSearchActive: true,
          },
          null,
          2,
        ),
      },
    ],
  };
};
