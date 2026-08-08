import type { VisaSponsor } from "../types/visa-sponsors";
import { parseCsvRows } from "./csv";

/**
 * Find the most recent H-1B employer data hub CSV link on the USCIS archive
 * page (hrefs may be absolute or site-relative).
 */
export function extractH1bEmployerCsvUrl(pageHtml: string): string | null {
  const pattern = /href="([^"]*h1b_datahubexport-(\d{4})\.csv)"/g;
  let bestUrl: string | null = null;
  let bestYear = -1;

  for (const match of pageHtml.matchAll(pattern)) {
    const year = Number(match[2]);
    if (year > bestYear) {
      bestYear = year;
      bestUrl = match[1];
    }
  }

  return bestUrl;
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
