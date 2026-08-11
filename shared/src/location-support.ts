import type { JobSource } from "./types";

const COUNTRY_ALIASES: Record<string, string> = {
  uk: "united kingdom",
  us: "united states",
  usa: "united states",
  türkiye: "turkey",
  "czech republic": "czechia",
};

const COUNTRY_LABELS: Record<string, string> = {
  "united states": "United States",
  "usa/ca": "USA/CA",
  turkey: "Turkey",
  czechia: "Czechia",
};

// App-supported countries. The system operates in the US, Canada, and India
// only; other JobSpy-supported countries are intentionally not offered.
export const SUPPORTED_COUNTRY_INPUTS = [
  "united states",
  "canada",
  "india",
] as const;

const US_ONLY_SOURCES = new Set<JobSource>([
  "dice",
  "builtin",
  "usajobs",
  "snagajob",
  "flexjobs",
  "hired",
]);
const US_CA_SOURCES = new Set<JobSource>([
  "ziprecruiter",
  "simplyhired",
  "roberthalf",
]);
const INDIA_SOURCES = new Set<JobSource>([
  "naukri",
  "instahyre",
  "foundit",
  "shine",
  "timesjobs",
  "freshersworld",
  "iimjobs",
  "cutshort",
  "ncs",
  "apna",
  "internshala",
]);
const BANGLADESH_SOURCES = new Set<JobSource>(["bdjobs"]);
const CANADA_SOURCES = new Set<JobSource>(["eluta", "jobbank", "jobboom"]);
const GLASSDOOR_SUPPORTED_COUNTRIES = new Set(
  [
    "australia",
    "austria",
    "belgium",
    "brazil",
    "canada",
    "france",
    "germany",
    "hong kong",
    "india",
    "ireland",
    "italy",
    "mexico",
    "netherlands",
    "new zealand",
    "singapore",
    "spain",
    "switzerland",
    "united states",
    "vietnam",
  ].map((country) => normalizeCountryKey(country)),
);
const ADZUNA_COUNTRY_CODE_BY_KEY: Record<string, string> = {
  "united states": "us",
  austria: "at",
  australia: "au",
  belgium: "be",
  brazil: "br",
  canada: "ca",
  switzerland: "ch",
  germany: "de",
  spain: "es",
  france: "fr",
  india: "in",
  italy: "it",
  mexico: "mx",
  netherlands: "nl",
  "new zealand": "nz",
  poland: "pl",
  singapore: "sg",
  "south africa": "za",
};

export function normalizeCountryKey(value: string | null | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? "";
  return COUNTRY_ALIASES[normalized] ?? normalized;
}

export function formatCountryLabel(value: string): string {
  const normalized = normalizeCountryKey(value);
  if (!normalized) return "";
  return (
    COUNTRY_LABELS[normalized] ||
    normalized.replace(/\b\w/g, (char) => char.toUpperCase())
  );
}

export const SUPPORTED_COUNTRY_KEYS = Array.from(
  new Set(
    SUPPORTED_COUNTRY_INPUTS.map((country) => normalizeCountryKey(country)),
  ),
).filter(Boolean);

export function isUsCountry(country: string | null | undefined): boolean {
  return normalizeCountryKey(country) === "united states";
}

export function isCanadaCountry(country: string | null | undefined): boolean {
  return normalizeCountryKey(country) === "canada";
}

export function isIndiaCountry(country: string | null | undefined): boolean {
  return normalizeCountryKey(country) === "india";
}

export function isBangladeshCountry(
  country: string | null | undefined,
): boolean {
  return normalizeCountryKey(country) === "bangladesh";
}

export function isGlassdoorCountry(
  country: string | null | undefined,
): boolean {
  return GLASSDOOR_SUPPORTED_COUNTRIES.has(normalizeCountryKey(country));
}

export function getAdzunaCountryCode(
  country: string | null | undefined,
): string | null {
  return ADZUNA_COUNTRY_CODE_BY_KEY[normalizeCountryKey(country)] ?? null;
}

export function isSourceAllowedForCountry(
  source: JobSource,
  country: string | null | undefined,
): boolean {
  if (US_ONLY_SOURCES.has(source)) return isUsCountry(country);
  if (US_CA_SOURCES.has(source))
    return isUsCountry(country) || isCanadaCountry(country);
  if (INDIA_SOURCES.has(source)) return isIndiaCountry(country);
  if (BANGLADESH_SOURCES.has(source)) return isBangladeshCountry(country);
  if (CANADA_SOURCES.has(source)) return isCanadaCountry(country);
  if (source === "glassdoor") return isGlassdoorCountry(country);
  if (source === "adzuna") return getAdzunaCountryCode(country) !== null;
  return true;
}

export function getCompatibleSourcesForCountry(
  sources: JobSource[],
  country: string | null | undefined,
): JobSource[] {
  return sources.filter((source) => isSourceAllowedForCountry(source, country));
}
