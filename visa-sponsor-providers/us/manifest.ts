import type {
  VisaSponsor,
  VisaSponsorProviderManifest,
} from "@shared/types/visa-sponsors";
import {
  extractH1bEmployerCsvUrls,
  mergeH1bEmployerYears,
  parseH1bEmployerCsv,
} from "@shared/visa-sponsors/h1b";

const ARCHIVE_PAGE_URL =
  "https://www.uscis.gov/archive/h-1b-employer-data-hub-files";

/** How many of the most recent published fiscal year files to merge. */
const MAX_YEARS = 3;

const FETCH_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml",
};

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: FETCH_HEADERS });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }
  return response.text();
}

export const manifest: VisaSponsorProviderManifest = {
  id: "us",
  displayName: "United States",
  countryKey: "united states",
  scheduledUpdateHour: 3,

  async fetchSponsors(): Promise<VisaSponsor[]> {
    const pageHtml = await fetchText(ARCHIVE_PAGE_URL);
    const csvPaths = extractH1bEmployerCsvUrls(pageHtml, MAX_YEARS);
    if (csvPaths.length === 0) {
      throw new Error("Could not find H-1B employer data CSV on USCIS archive");
    }

    const yearlySponsors: VisaSponsor[][] = [];
    for (const csvPath of csvPaths) {
      const csvUrl = csvPath.startsWith("http")
        ? csvPath
        : `https://www.uscis.gov${csvPath}`;
      const csvContent = await fetchText(csvUrl);
      const sponsors = parseH1bEmployerCsv(csvContent);
      if (sponsors.length === 0) {
        throw new Error(
          `US H-1B employer CSV appears empty or invalid: ${csvUrl}`,
        );
      }
      yearlySponsors.push(sponsors);
    }

    const sponsors = mergeH1bEmployerYears(yearlySponsors);
    if (sponsors.length === 0) {
      throw new Error("US H-1B employer data appears empty or invalid");
    }

    return sponsors;
  },
};

export default manifest;
