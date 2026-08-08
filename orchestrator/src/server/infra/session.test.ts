import { describe, expect, it } from "vitest";
import {
  createSessionToken,
  readSessionFromCookieHeader,
  sessionClearCookieHeader,
  sessionSetCookieHeader,
  verifySessionToken,
} from "./session";

describe("session", () => {
  it("round-trips a signed session token for a user", () => {
    const token = createSessionToken("user-123");
    const verified = verifySessionToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe("user-123");
    expect(verified?.expiresAt).toBeGreaterThan(Date.now());
  });

  it("rejects a tampered userId (signature mismatch)", () => {
    const token = createSessionToken("user-123");
    const tampered = `user-999.${token.split(".").slice(1).join(".")}`;
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it("rejects a token with a bad signature", () => {
    const token = createSessionToken("user-123");
    const parts = token.split(".");
    parts[2] = "aW52YWxpZCBzaWc";
    expect(verifySessionToken(parts.join("."))).toBeNull();
  });

  it("rejects a malformed token", () => {
    expect(verifySessionToken("not-a-token")).toBeNull();
    expect(verifySessionToken("a.b")).toBeNull();
    expect(verifySessionToken("")).toBeNull();
  });

  it("parses a session from a full Cookie header", () => {
    const token = createSessionToken("user-456");
    const cookieHeader = `_ga=GA1.2.x; ${sessionSetCookieHeader(token).split(";")[0]}; other=val`;
    const session = readSessionFromCookieHeader(cookieHeader);
    expect(session?.userId).toBe("user-456");
  });

  it("returns null when the session cookie is absent", () => {
    expect(readSessionFromCookieHeader(undefined)).toBeNull();
    expect(readSessionFromCookieHeader("_ga=GA1.2.x")).toBeNull();
  });

  it("emits HttpOnly + SameSite=Lax cookie flags", () => {
    const token = createSessionToken("user-1");
    const header = sessionSetCookieHeader(token);
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Max-Age=");
    expect(header).toContain(`jobops.session=${token}`);
  });

  it("clears the session cookie with Max-Age=0", () => {
    expect(sessionClearCookieHeader()).toContain("Max-Age=0");
    expect(sessionClearCookieHeader()).toContain("jobops.session=");
  });
});
