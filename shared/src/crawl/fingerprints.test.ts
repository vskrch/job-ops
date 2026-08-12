import { describe, expect, it } from "vitest";
import { BROWSER_FINGERPRINTS } from "./fingerprints";

describe("BROWSER_FINGERPRINTS", () => {
  it("contains 28-32 fingerprints", () => {
    expect(BROWSER_FINGERPRINTS.length).toBeGreaterThanOrEqual(28);
    expect(BROWSER_FINGERPRINTS.length).toBeLessThanOrEqual(32);
  });

  it("includes mobile fingerprints", () => {
    const mobile = BROWSER_FINGERPRINTS.filter((f) =>
      /Mobile|Android|iPhone/.test(f.userAgent),
    );
    expect(mobile.length).toBeGreaterThanOrEqual(8);
  });

  it("has at least 3 different accept-language values", () => {
    const locales = new Set(BROWSER_FINGERPRINTS.map((f) => f.acceptLanguage));
    expect(locales.size).toBeGreaterThanOrEqual(3);
  });

  it("Chrome versions are >= 140", () => {
    for (const fingerprint of BROWSER_FINGERPRINTS) {
      const match = /Chrome\/(\d+)/.exec(fingerprint.userAgent);
      if (match) {
        expect(Number(match[1])).toBeGreaterThanOrEqual(140);
      }
    }
  });

  it("every fingerprint has a unique user agent", () => {
    const uas = BROWSER_FINGERPRINTS.map((f) => f.userAgent);
    expect(new Set(uas).size).toBe(uas.length);
  });

  it("every fingerprint has an accept-language", () => {
    for (const fingerprint of BROWSER_FINGERPRINTS) {
      expect(fingerprint.acceptLanguage.length).toBeGreaterThan(0);
      expect(fingerprint.userAgent.length).toBeGreaterThan(0);
    }
  });

  it("pairs sec-ch-ua with platform hints on Chromium families only", () => {
    for (const fingerprint of BROWSER_FINGERPRINTS) {
      const isChromium = /Chrome|Edg/.test(fingerprint.userAgent);
      if (isChromium) {
        expect(fingerprint.secChUa).toBeTruthy();
        expect(fingerprint.secChUaPlatform).toBeTruthy();
      } else {
        // Firefox/Safari do not send sec-ch-ua.
        expect(fingerprint.secChUa).toBeUndefined();
      }
    }
  });
});
