import type { VisaSponsor } from "../types/visa-sponsors";
import { parseCsvRows } from "./csv";

/**
 * Find the most recent H-1B employer data hub CSV links on the USCIS archive
 * page (hrefs may be absolute or site-relative), newest year first.
 */
export function extractH1bEmployerCsvUrls(
  pageHtml: string,
  maxYears = 3,
): string[] {
  const pattern = /href="([^"]*h1b_datahubexport-(\d{4})\.csv)"/g;
  const urlsByYear = new Map<number, string>();

  for (const match of pageHtml.matchAll(pattern)) {
    const year = Number(match[2]);
    const existing = urlsByYear.get(year);
    if (!existing || match[1].length < existing.length) {
      urlsByYear.set(year, match[1]);
    }
  }

  return [...urlsByYear.keys()]
    .sort((a, b) => b - a)
    .slice(0, maxYears)
    .map((year) => urlsByYear.get(year) ?? "");
}

/**
 * Parse the USCIS H-1B employer data hub CSV into VisaSponsor entries.
 * Each row is an employer/NAICS/state/city combination; rows with an empty
 * employer name (anonymised) and exact duplicates are skipped.
 */
export function parseH1bEmployerCsv(content: string): VisaSponsor[] {
  const rows = parseCsvRows(content);
  if (rows.length === 0) {
    return [];
  }

  const header = rows[0].map((cell) => cell.trim().toLowerCase());
  const column = (name: string): number => header.indexOf(name);
  const employerColumn = column("employer");
  const cityColumn = column("city");
  const stateColumn = column("state");
  const naicsColumn = column("naics");
  const fiscalYearColumn = column("fiscal year");

  if (employerColumn < 0) {
    throw new Error("US H-1B CSV is missing the 'Employer' column");
  }

  const sponsors: VisaSponsor[] = [];
  const seen = new Set<string>();

  for (const row of rows.slice(1)) {
    const organisationName = (row[employerColumn] ?? "").trim();
    if (!organisationName) continue;

    const townCity = cityColumn >= 0 ? (row[cityColumn] ?? "").trim() : "";
    const county = stateColumn >= 0 ? (row[stateColumn] ?? "").trim() : "";
    const naics = naicsColumn >= 0 ? (row[naicsColumn] ?? "").trim() : "";
    const fiscalYear =
      fiscalYearColumn >= 0 ? (row[fiscalYearColumn] ?? "").trim() : "";

    const dedupeKey = [
      organisationName,
      townCity,
      county,
      naics,
      fiscalYear,
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    sponsors.push({
      organisationName,
      townCity,
      county,
      typeRating: naics ? `NAICS ${naics}` : "H-1B",
      route: fiscalYear ? `H-1B (FY${fiscalYear})` : "H-1B",
    });
  }

  return sponsors;
}

/**
 * Merge per-fiscal-year sponsor lists, newest year first. Exact duplicates
 * (same employer, location, and NAICS in a newer year) are dropped so each
 * employer/location/NAICS combination appears once with the most recent
 * fiscal year's route label.
 */
export function mergeH1bEmployerYears(
  yearlySponsors: VisaSponsor[][],
): VisaSponsor[] {
  const merged: VisaSponsor[] = [];
  const seen = new Set<string>();

  for (const sponsors of yearlySponsors) {
    for (const sponsor of sponsors) {
      const dedupeKey = [
        sponsor.organisationName,
        sponsor.townCity,
        sponsor.county,
        sponsor.typeRating,
      ].join("|");
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      merged.push(sponsor);
    }
  }

  return merged;
}
