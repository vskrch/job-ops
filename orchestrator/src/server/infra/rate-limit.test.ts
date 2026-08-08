import { describe, expect, it } from "vitest";
import { __resetRateLimitForTests, checkRateLimit } from "./rate-limit";

describe("rate-limit", () => {
  it("allows requests up to the limit within the window", () => {
    __resetRateLimitForTests();
    const options = { max: 3, windowMs: 60_000 };
    expect(checkRateLimit("ip:/login", options).allowed).toBe(true);
    expect(checkRateLimit("ip:/login", options).allowed).toBe(true);
    expect(checkRateLimit("ip:/login", options).allowed).toBe(true);
    const blocked = checkRateLimit("ip:/login", options);
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets the counter after the window expires", () => {
    __resetRateLimitForTests();
    const options = { max: 1, windowMs: 1 };
    expect(checkRateLimit("ip:/register", options).allowed).toBe(true);
    expect(checkRateLimit("ip:/register", options).allowed).toBe(false);
    // After the 1ms window, a new window opens.
    return new Promise((resolve) => {
      setTimeout(() => {
        expect(checkRateLimit("ip:/register", options).allowed).toBe(true);
        resolve(null);
      }, 10);
    });
  });

  it("tracks keys independently per IP+route", () => {
    __resetRateLimitForTests();
    const options = { max: 1, windowMs: 60_000 };
    expect(checkRateLimit("ip-a:/login", options).allowed).toBe(true);
    expect(checkRateLimit("ip-b:/login", options).allowed).toBe(true);
    expect(checkRateLimit("ip-a:/login", options).allowed).toBe(false);
    expect(checkRateLimit("ip-a:/register", options).allowed).toBe(true);
  });
});
