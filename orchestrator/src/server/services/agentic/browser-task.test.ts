import { createAppSettings } from "@shared/testing/factories";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserTaskBudget,
  isBrowserAgentEnabled,
  isBrowserAutoApplyEnabled,
  runBrowserTask,
} from "./browser-task";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.unstubAllEnvs();
});

describe("browser-task", () => {
  it("isBrowserAgentEnabled reflects the setting", () => {
    const settings = createAppSettings();
    expect(isBrowserAgentEnabled(settings)).toBe(false);
    const enabled = createAppSettings({
      browserAgentEnabled: { value: true, default: false, override: null },
    });
    expect(isBrowserAgentEnabled(enabled)).toBe(true);
  });

  it("isBrowserAutoApplyEnabled reflects the setting", () => {
    const settings = createAppSettings();
    expect(isBrowserAutoApplyEnabled(settings)).toBe(false);
  });

  it("browserTaskBudget reads settings with defaults", () => {
    const settings = createAppSettings();
    const budget = browserTaskBudget(settings);
    expect(budget.maxSteps).toBe(10);
    expect(budget.timeoutMs).toBe(60000);
    expect(budget.maxCost).toBeCloseTo(0.1);
  });

  it("runBrowserTask returns disabled when the flag is off", async () => {
    const settings = createAppSettings();
    const result = await runBrowserTask(
      { task: "Go to example.com" },
      settings,
    );
    expect(result.disabled).toBe(true);
    expect(result.success).toBe(false);
  });

  it("runBrowserTask returns not-configured error when BROWSER_USE_BASE_URL is unset", async () => {
    delete process.env.BROWSER_USE_BASE_URL;
    const settings = createAppSettings({
      browserAgentEnabled: { value: true, default: false, override: null },
    });
    const result = await runBrowserTask(
      { task: "Go to example.com" },
      settings,
    );
    expect(result.disabled).toBeUndefined();
    expect(result.success).toBe(false);
    expect(result.error).toContain("not configured");
  });

  it("runBrowserTask rejects empty tasks", async () => {
    process.env.BROWSER_USE_BASE_URL = "http://localhost:8000";
    const settings = createAppSettings({
      browserAgentEnabled: { value: true, default: false, override: null },
    });
    const result = await runBrowserTask({ task: "   " }, settings);
    expect(result.success).toBe(false);
    expect(result.error).toContain("empty");
  });

  it("runBrowserTask rejects over-long tasks", async () => {
    process.env.BROWSER_USE_BASE_URL = "http://localhost:8000";
    const settings = createAppSettings({
      browserAgentEnabled: { value: true, default: false, override: null },
    });
    const result = await runBrowserTask({ task: "x".repeat(8001) }, settings);
    expect(result.success).toBe(false);
    expect(result.error).toContain("8000");
  });

  it("runBrowserTask calls the sidecar and returns its result", async () => {
    process.env.BROWSER_USE_BASE_URL = "http://localhost:8000";
    process.env.BROWSER_USE_API_TOKEN = "secret-token";
    const settings = createAppSettings({
      browserAgentEnabled: { value: true, default: false, override: null },
      browserAgentMaxSteps: { value: 5, default: 10, override: null },
      browserAgentTimeoutMs: { value: 30000, default: 60000, override: null },
    });

    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        expect(init?.headers).toMatchObject({
          Authorization: "Bearer secret-token",
          "Content-Type": "application/json",
        });
        const body = JSON.parse(String(init?.body));
        expect(body.task).toBe("Go to example.com");
        expect(body.maxSteps).toBe(5);
        return {
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            result: { text: "Example Domain" },
            screenshots: [],
            steps: 2,
          }),
          text: async () => "",
        } as Response;
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runBrowserTask(
      { task: "Go to example.com" },
      settings,
    );
    expect(result.success).toBe(true);
    expect(result.result).toEqual({ text: "Example Domain" });
    expect(result.steps).toBe(2);
  });

  it("runBrowserTask surfaces sidecar errors gracefully", async () => {
    process.env.BROWSER_USE_BASE_URL = "http://localhost:8000";
    const settings = createAppSettings({
      browserAgentEnabled: { value: true, default: false, override: null },
    });
    const fetchMock = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await runBrowserTask(
      { task: "Go to example.com" },
      settings,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
