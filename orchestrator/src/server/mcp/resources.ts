/**
 * MCP Resources (ADR-008).
 *
 * Exposes read-only contextual resources:
 * - jobops://profile
 * - jobops://settings
 * - jobops://stats
 */

import * as jobsRepo from "@server/repositories/jobs";
import * as settingsRepo from "@server/repositories/settings";
import { getProfile } from "@server/services/profile";
import type { McpResource, McpResourceContent } from "./types";

export const MCP_RESOURCES: McpResource[] = [
  {
    uri: "jobops://profile",
    name: "Candidate Profile",
    description:
      "The user's parsed resume profile, skills, experience, and target job preferences.",
    mimeType: "application/json",
  },
  {
    uri: "jobops://settings",
    name: "JobOps System Settings",
    description:
      "Current application settings including LLM provider, target cities, and crawl configs.",
    mimeType: "application/json",
  },
  {
    uri: "jobops://stats",
    name: "Job Pipeline Statistics",
    description:
      "Breakdown of tracked jobs across discovered, processing, ready, applied, and interview stages.",
    mimeType: "application/json",
  },
];

export async function readMcpResource(
  uri: string,
): Promise<McpResourceContent> {
  switch (uri) {
    case "jobops://profile": {
      try {
        const profile = await getProfile();
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(profile, null, 2),
        };
      } catch (_err) {
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({
            error: "No profile configured or parsed yet",
          }),
        };
      }
    }
    case "jobops://settings": {
      const settings = await settingsRepo.getAllSettings();
      // Mask any sensitive keys
      const safe = { ...settings };
      if (safe.serpApiKey) safe.serpApiKey = "[MASKED]";
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(safe, null, 2),
      };
    }
    case "jobops://stats": {
      const stats = await jobsRepo.getJobStats();
      return {
        uri,
        mimeType: "application/json",
        text: JSON.stringify(stats, null, 2),
      };
    }
    default:
      throw new Error(`Resource not found: ${uri}`);
  }
}
