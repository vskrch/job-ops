import { describe, expect, it } from "vitest";
import type { BrowserFingerprint } from "./fingerprints";
import {
  __resetOrganicHeadersStateForTests,
  buildOrganicHeaders,
} from "./organic-headers";

const CHROME: BrowserFingerprint = {
  label: "Chrome",
  userAgent: "UA",
  secChUa: '"Chromium";v="126"',
  secChUaMobile: "?0",
  secChUaPlatform: '"Windows"',
  acceptLanguage: "en-US,en;q=0.9",
};

const FIREFOX: BrowserFingerprint = {
  label: "Firefox",
  userAgent: "UA-FX",
  acceptLanguage: "en-GB,en;q=0.9",
};

describe("buildOrganicHeaders", () => {
  it("adds deterministic sec-fetch navigation headers", () => {
    __resetOrganicHeadersStateForTests();
    const headers = buildOrganicHeaders("https://example.com/jobs", CHROME);
    expect(headers["sec-fetch-dest"]).toBe("document");
    expect(headers["sec-fetch-mode"]).toBe("navigate");
    expect(headers["sec-fetch-user"]).toBe("?1");
  });

  it("uses cross-site + google referer on the first visit to a domain", () => {
    __resetOrganicHeadersStateForTests();
    const headers = buildOrganicHeaders("https://example.com/jobs", CHROME);
    expect(headers["sec-fetch-site"]).toBe("cross-site");
    expect(headers.referer).toBe("https://www.google.com/");
  });

  it("uses same-origin on subsequent visits to the same domain", () => {
    __resetOrganicHeadersStateForTests();
    buildOrganicHeaders("https://example.com/jobs/1", CHROME);
    const second = buildOrganicHeaders("https://example.com/jobs/2", CHROME);
    expect(second["sec-fetch-site"]).toBe("same-origin");
    expect(second.referer).toBeUndefined();
  });

  it("adds DNT: 1 roughly 30% of the time (deterministic check via stub)", () => {
    __resetOrganicHeadersStateForTests();
    const originalRandom = Math.random;
    Math.random = () => 0.2; // below 0.3 threshold -> DNT set
    try {
      const headers = buildOrganicHeaders("https://example.com/jobs", CHROME);
      expect(headers.dnt).toBe("1");
    } finally {
      Math.random = originalRandom;
    }
  });

  it("omits DNT when the random draw is above the threshold", () => {
    __resetOrganicHeadersStateForTests();
    const originalRandom = Math.random;
    Math.random = () => 0.9; // above 0.3 threshold -> no DNT
    try {
      const headers = buildOrganicHeaders("https://example.com/jobs", CHROME);
      expect(headers.dnt).toBeUndefined();
    } finally {
      Math.random = originalRandom;
    }
  });

  it("uses the fingerprint's accept-language", () => {
    __resetOrganicHeadersStateForTests();
    const headers = buildOrganicHeaders("https://example.com/jobs", CHROME);
    expect(headers["accept-language"]).toBe("en-US,en;q=0.9");
  });

  it("omits sec-ch-ua for Firefox/Safari fingerprints", () => {
    __resetOrganicHeadersStateForTests();
    const headers = buildOrganicHeaders("https://example.com/jobs", FIREFOX);
    expect(headers["sec-ch-ua"]).toBeUndefined();
  });
});
