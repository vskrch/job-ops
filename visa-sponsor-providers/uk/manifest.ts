import type {
  VisaSponsor,
  VisaSponsorProviderManifest,
} from "@shared/types/visa-sponsors";
import { parseVisaSponsorsCsv } from "@shared/visa-sponsors/csv";

const GOV_UK_PAGE_URL =
  "https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers";

const CSV_LINK_PATTERN =
  /href="(https:\/\/assets\.publishing\.service\.gov\.uk\/media\/[^"]+\.csv)"/g;

async function extractCsvUrl(): Promise<string> {
  const response = await fetch(GOV_UK_PAGE_URL);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch gov.uk page: ${response.status} ${response.statusText}`,
    );
  }

  const html = await response.text();
  const candidates = [...html.matchAll(CSV_LINK_PATTERN)].map(
    (match) => match[1],
  );
  if (candidates.length === 0) {
    throw new Error(
      "Could not find Worker and Temporary Worker CSV link on gov.uk page",
    );
  }

  return (
    candidates.find((url) => url.includes("Worker_and_Temporary_Worker")) ??
    candidates[0]
  );
}

export const manifest: VisaSponsorProviderManifest = {
  id: "uk",
  displayName: "United Kingdom",
  countryKey: "united kingdom",
  scheduledUpdateHour: 2,

  async fetchSponsors(): Promise<VisaSponsor[]> {
    const csvUrl = await extractCsvUrl();
    const response = await fetch(csvUrl);
    if (!response.ok) {
      throw new Error(
        `Failed to download UK sponsor CSV: ${response.status} ${response.statusText}`,
      );
    }

    const content = await response.text();
    const sponsors = parseVisaSponsorsCsv(content);
    if (sponsors.length === 0) {
      throw new Error("UK sponsor CSV appears empty or invalid");
    }

    return sponsors;
  },
};

export default manifest;
