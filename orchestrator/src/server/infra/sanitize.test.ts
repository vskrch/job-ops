import { describe, expect, it } from "vitest";
import { sanitizeUnknown } from "./sanitize";

describe("sanitizeUnknown", () => {
  it("redacts sensitive keys", () => {
    const result = sanitizeUnknown({
      name: "ok",
      password: "secret123",
      authorization: "Bearer abc",
      token: "xyz",
    }) as Record<string, unknown>;

    expect(result.name).toBe("ok");
    expect(result.password).toBe("[REDACTED]");
    expect(result.authorization).toBe("[REDACTED]");
    expect(result.token).toBe("[REDACTED]");
  });

  it("truncates long strings", () => {
    const result = sanitizeUnknown({ key: "x".repeat(1000) }) as Record<
      string,
      unknown
    >;
    expect(result.key).not.toContain("x".repeat(1000));
    expect(result.key).toContain("truncated");
  });

  it("serializes Map as a string instead of iterating entries", () => {
    const map = new Map([["password", "secret"]]);
    const result = sanitizeUnknown({ data: map }) as Record<string, unknown>;
    expect(typeof result.data).toBe("string");
    expect(result.data).toContain("[object Map]");
  });

  it("serializes Set as a string instead of iterating entries", () => {
    const set = new Set([1, 2, 3]);
    const result = sanitizeUnknown({ data: set }) as Record<string, unknown>;
    expect(typeof result.data).toBe("string");
    expect(result.data).toContain("[object Set]");
  });

  it("serializes Date as ISO string instead of iterating properties", () => {
    const date = new Date("2026-01-01T00:00:00Z");
    const result = sanitizeUnknown({ data: date }) as Record<string, unknown>;
    expect(result.data).toBe("2026-01-01T00:00:00.000Z");
  });

  it("serializes RegExp as a string", () => {
    const regex = /secret-token/g;
    const result = sanitizeUnknown({ data: regex }) as Record<string, unknown>;
    expect(typeof result.data).toBe("string");
    expect(result.data).toContain("secret-token");
  });
});
