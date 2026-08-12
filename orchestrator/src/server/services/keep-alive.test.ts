import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  resolvePublicBaseUrl,
  startKeepAliveService,
  stopKeepAliveService,
} from "./keep-alive";

describe("keep-alive service", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    stopKeepAliveService();
    process.env = { ...originalEnv };
    delete process.env.JOBOPS_PUBLIC_BASE_URL;
    delete process.env.HEROKU_APP_NAME;
  });

  afterEach(() => {
    stopKeepAliveService();
    process.env = { ...originalEnv };
  });

  it("resolves public base URL from JOBOPS_PUBLIC_BASE_URL when present", () => {
    process.env.JOBOPS_PUBLIC_BASE_URL = "https://my-app.example.com/";
    expect(resolvePublicBaseUrl()).toBe("https://my-app.example.com");
  });

  it("resolves public base URL from HEROKU_APP_NAME fallback", () => {
    process.env.HEROKU_APP_NAME = "job-ops-app";
    expect(resolvePublicBaseUrl()).toBe("https://job-ops-app.herokuapp.com");
  });

  it("returns null if no public URL environment variables are present", () => {
    expect(resolvePublicBaseUrl()).toBeNull();
  });

  it("starts and stops keep-alive timer without throwing", () => {
    process.env.HEROKU_APP_NAME = "job-ops-app";
    expect(() => startKeepAliveService()).not.toThrow();
    expect(() => stopKeepAliveService()).not.toThrow();
  });
});
