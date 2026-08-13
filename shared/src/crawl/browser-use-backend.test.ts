import { describe, expect, it } from "vitest";
import {
  browserUseFetch,
  createBrowserUseBackend,
} from "./browser-use-backend";
import type { BrowserTaskResult, BrowserUseClient } from "./browser-use-client";

function mockClient(result: BrowserTaskResult): BrowserUseClient {
  return {
    async runTask() {
      return result;
    },
    async health() {
      return true;
    },
  };
}

describe("browserUseFetch", () => {
  it("returns ok with page text on success", async () => {
    const client = mockClient({
      success: true,
      result: { text: "Software Engineer at ACME Corp" },
      screenshots: [],
      steps: 3,
    });
    const result = await browserUseFetch(client, "https://example.com/jobs");
    expect(result.ok).toBe(true);
    expect(result.text).toBe("Software Engineer at ACME Corp");
    expect(result.contentType).toBe("text/markdown");
  });

  it("returns failure when task fails", async () => {
    const client = mockClient({
      success: false,
      result: null,
      screenshots: [],
      steps: 0,
      error: "Agent could not navigate",
    });
    const result = await browserUseFetch(client, "https://blocked.com");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Agent could not navigate");
  });

  it("returns failure when no text is extracted", async () => {
    const client = mockClient({
      success: true,
      result: {},
      screenshots: [],
      steps: 5,
    });
    const result = await browserUseFetch(client, "https://example.com");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("no page text");
  });
});

describe("createBrowserUseBackend", () => {
  it("returns null when BROWSER_USE_BASE_URL is not set", () => {
    const previous = process.env.BROWSER_USE_BASE_URL;
    delete process.env.BROWSER_USE_BASE_URL;
    try {
      expect(createBrowserUseBackend()).toBeNull();
    } finally {
      if (previous) process.env.BROWSER_USE_BASE_URL = previous;
    }
  });
});
