import { describe, expect, it } from "vitest";
import {
  formatCountryLabel,
  getAdzunaCountryCode,
  getCompatibleSourcesForCountry,
  isGlassdoorCountry,
  isSourceAllowedForCountry,
  normalizeCountryKey,
  SUPPORTED_COUNTRY_KEYS,
} from "./location-support";

describe("location-support", () => {
  it("normalizes country aliases", () => {
    expect(normalizeCountryKey("UK")).toBe("united kingdom");
    expect(normalizeCountryKey("us")).toBe("united states");
    expect(normalizeCountryKey("usa")).toBe("united states");
    expect(normalizeCountryKey("czech republic")).toBe("czechia");
  });

  it("formats country labels", () => {
    expect(formatCountryLabel("united kingdom")).toBe("United Kingdom");
    expect(formatCountryLabel("usa/ca")).toBe("USA/CA");
    expect(formatCountryLabel("south korea")).toBe("South Korea");
  });

  it("keeps supported country keys unique and canonical", () => {
    expect(SUPPORTED_COUNTRY_KEYS).toContain("united states");
    expect(SUPPORTED_COUNTRY_KEYS).toContain("canada");
    expect(SUPPORTED_COUNTRY_KEYS).toContain("india");
    expect(SUPPORTED_COUNTRY_KEYS).not.toContain("united kingdom");
    expect(SUPPORTED_COUNTRY_KEYS).not.toContain("worldwide");
    expect(SUPPORTED_COUNTRY_KEYS).not.toContain("uk");
    expect(SUPPORTED_COUNTRY_KEYS).not.toContain("us");
  });

  it("applies source compatibility rules by country", () => {
    expect(isSourceAllowedForCountry("indeed", "united states")).toBe(true);
    expect(isSourceAllowedForCountry("linkedin", "worldwide")).toBe(true);
    expect(isSourceAllowedForCountry("glassdoor", "united states")).toBe(true);
    expect(isSourceAllowedForCountry("glassdoor", "japan")).toBe(false);
    expect(isSourceAllowedForCountry("adzuna", "united states")).toBe(true);
    expect(isSourceAllowedForCountry("adzuna", "japan")).toBe(false);
    expect(isSourceAllowedForCountry("startupjobs", "united states")).toBe(
      true,
    );
    expect(isSourceAllowedForCountry("startupjobs", "worldwide")).toBe(true);
    expect(isSourceAllowedForCountry("usajobs", "united states")).toBe(true);
    expect(isSourceAllowedForCountry("usajobs", "united kingdom")).toBe(false);
    expect(isSourceAllowedForCountry("usajobs", "worldwide")).toBe(false);
    expect(isSourceAllowedForCountry("eluta", "canada")).toBe(true);
    expect(isSourceAllowedForCountry("eluta", "united states")).toBe(false);
    expect(isSourceAllowedForCountry("instahyre", "india")).toBe(true);
    expect(isSourceAllowedForCountry("instahyre", "canada")).toBe(false);
  });

  it("filters incompatible sources while preserving compatible order", () => {
    expect(
      getCompatibleSourcesForCountry(
        ["indeed", "glassdoor", "adzuna", "startupjobs", "linkedin", "eluta"],
        "united states",
      ),
    ).toEqual(["indeed", "glassdoor", "adzuna", "startupjobs", "linkedin"]);
  });

  it("supports glassdoor only in explicitly supported countries", () => {
    expect(isGlassdoorCountry("canada")).toBe(true);
    expect(isGlassdoorCountry("india")).toBe(true);
    expect(isGlassdoorCountry("usa")).toBe(true);
    expect(isGlassdoorCountry("japan")).toBe(false);
    expect(isGlassdoorCountry("united kingdom")).toBe(false);
  });

  it("maps adzuna country keys to adzuna api country codes", () => {
    expect(getAdzunaCountryCode("united states")).toBe("us");
    expect(getAdzunaCountryCode("canada")).toBe("ca");
    expect(getAdzunaCountryCode("UK")).toBeNull();
    expect(getAdzunaCountryCode("japan")).toBeNull();
  });
});
