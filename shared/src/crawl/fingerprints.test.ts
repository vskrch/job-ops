import { describe, expect, it } from "vitest";
import { BROWSER_FINGERPRINTS } from "./fingerprints";

describe("BROWSER_FINGERPRINTS", () => {
  it("contains ~20 fingerprints", () => {
    expect(BROWSER_FINGERPRINTS.length).toBeGreaterThanOrEqual(18);
    expect(BROWSER_FINGERPRINTS.length).toBeLessThanOrEqual(24);
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
