import type { VisaSponsor } from "../types/visa-sponsors";

/**
 * Map rows from the IRCC positive LMIA employer workbook into VisaSponsor
 * entries. The header row is located by scanning for a row containing an
 * "Employer" cell so quarter-to-quarter column layout changes are tolerated.
 */
export function parseLmiaEmployerRows(
  rows: (string | number)[][],
): VisaSponsor[] {
  let headerIndex = -1;
  let header: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const normalized = rows[i].map((cell) => String(cell).trim().toLowerCase());
    if (normalized.includes("employer")) {
      headerIndex = i;
      header = normalized;
      break;
    }
  }

  if (headerIndex < 0) {
    throw new Error("Canada LMIA workbook is missing the 'Employer' header");
  }

  const column = (name: string): number => header.indexOf(name);
  const employerColumn = column("employer");
  const provinceColumn = column("province/territory");
  const addressColumn = column("address");
  const streamColumn = column("program stream");
  const occupationColumn = column("occupation");

  const sponsors: VisaSponsor[] = [];
  const seen = new Set<string>();

  for (const row of rows.slice(headerIndex + 1)) {
    const organisationName = String(row[employerColumn] ?? "").trim();
    if (!organisationName) continue;

    const address =
      addressColumn >= 0 ? String(row[addressColumn] ?? "").trim() : "";
    const townCity = address.split(",")[0]?.trim() ?? "";
    const county =
      provinceColumn >= 0 ? String(row[provinceColumn] ?? "").trim() : "";
    const typeRating =
      streamColumn >= 0 ? String(row[streamColumn] ?? "").trim() : "";
    const occupation =
      occupationColumn >= 0 ? String(row[occupationColumn] ?? "").trim() : "";

    const dedupeKey = [
      organisationName,
      address,
      county,
      typeRating,
      occupation,
    ].join("|");
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    sponsors.push({
      organisationName,
      townCity,
      county,
      typeRating,
      route: occupation || "LMIA",
    });
  }

  return sponsors;
}
