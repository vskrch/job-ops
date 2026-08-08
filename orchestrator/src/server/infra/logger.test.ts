import { afterEach, describe, expect, it } from "vitest";
import { getConfiguredLogLevel } from "./logger";

describe("getConfiguredLogLevel", () => {
  const originalLevel = process.env.LOG_LEVEL;

  afterEach(() => {
    if (originalLevel === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = originalLevel;
    }
  });

  it("defaults to debug for full verbose console logging", () => {
    delete process.env.LOG_LEVEL;
    expect(getConfiguredLogLevel()).toBe("debug");
  });

  it("accepts verbose as an alias for debug", () => {
    process.env.LOG_LEVEL = "verbose";
    expect(getConfiguredLogLevel()).toBe("debug");
  });

  it("accepts trace as an alias for debug", () => {
    process.env.LOG_LEVEL = "trace";
    expect(getConfiguredLogLevel()).toBe("debug");
  });

  it("honors explicit levels", () => {
    for (const level of ["info", "warn", "error", "debug"] as const) {
      process.env.LOG_LEVEL = level;
      expect(getConfiguredLogLevel()).toBe(level);
    }
  });

  it("falls back to debug for unknown values", () => {
    process.env.LOG_LEVEL = "banana";
    expect(getConfiguredLogLevel()).toBe("debug");
  });

  it("treats the level case-insensitively", () => {
    process.env.LOG_LEVEL = "DEBUG";
    expect(getConfiguredLogLevel()).toBe("debug");
  });
});
