import { describe, expect, it } from "vitest";
import type { BrowserFingerprint } from "./fingerprints";
import { OrganicHeaders } from "./organic-headers";

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

describe("OrganicHeaders", () => {
  it("adds deterministic sec-fetch navigation headers", () => {
    const headers = new OrganicHeaders().build(
      "https://example.com/jobs",
      CHROME,
    );
    expect(headers["sec-fetch-dest"]).toBe("document");
    expect(headers["sec-fetch-mode"]).toBe("navigate");
    expect(headers["sec-fetch-user"]).toBe("?1");
  });

  it("uses cross-site + google referer on the first visit to a domain", () => {
    const headers = new OrganicHeaders().build(
      "https://example.com/jobs",
      CHROME,
    );
    expect(headers["sec-fetch-site"]).toBe("cross-site");
    expect(headers.referer).toBe("https://www.google.com/");
  });

  it("uses same-origin on subsequent visits to the same domain", () => {
    const oh = new OrganicHeaders();
    oh.build("https://example.com/jobs/1", CHROME);
    const second = oh.build("https://example.com/jobs/2", CHROME);
    expect(second["sec-fetch-site"]).toBe("same-origin");
    expect(second.referer).toBeUndefined();
  });

  it("isolates visited-domain state per instance (no cross-engine contamination)", () => {
    const oh1 = new OrganicHeaders();
    const oh2 = new OrganicHeaders();
    oh1.build("https://example.com/jobs", CHROME);
    // A fresh instance should still see this as a first visit.
    const headers = oh2.build("https://example.com/jobs", CHROME);
    expect(headers["sec-fetch-site"]).toBe("cross-site");
    expect(headers.referer).toBe("https://www.google.com/");
  });

  it("adds DNT: 1 roughly 30% of the time (deterministic check via stub)", () => {
    const originalRandom = Math.random;
    Math.random = () => 0.2; // below 0.3 threshold -> DNT set
    try {
      const headers = new OrganicHeaders().build(
        "https://example.com/jobs",
        CHROME,
      );
      expect(headers.dnt).toBe("1");
    } finally {
      Math.random = originalRandom;
    }
  });

  it("omits DNT when the random draw is above the threshold", () => {
    const originalRandom = Math.random;
    Math.random = () => 0.9; // above 0.3 threshold -> no DNT
    try {
      const headers = new OrganicHeaders().build(
        "https://example.com/jobs",
        CHROME,
      );
      expect(headers.dnt).toBeUndefined();
    } finally {
      Math.random = originalRandom;
    }
  });

  it("uses the fingerprint's accept-language", () => {
    const headers = new OrganicHeaders().build(
      "https://example.com/jobs",
      CHROME,
    );
    expect(headers["accept-language"]).toBe("en-US,en;q=0.9");
  });

  it("omits sec-ch-ua for Firefox/Safari fingerprints", () => {
    const headers = new OrganicHeaders().build(
      "https://example.com/jobs",
      FIREFOX,
    );
    expect(headers["sec-ch-ua"]).toBeUndefined();
  });
});
