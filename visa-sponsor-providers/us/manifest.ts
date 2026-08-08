import type {
  VisaSponsor,
  VisaSponsorProviderManifest,
} from "@shared/types/visa-sponsors";
import {
  extractH1bEmployerCsvUrl,
  parseH1bEmployerCsv,
} from "@shared/visa-sponsors/h1b";

const ARCHIVE_PAGE_URL =
  "https://www.uscis.gov/archive/h-1b-employer-data-hub-files";

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
    const csvPath = extractH1bEmployerCsvUrl(pageHtml);
    if (!csvPath) {
      throw new Error("Could not find H-1B employer data CSV on USCIS archive");
    }

    const csvUrl = csvPath.startsWith("http")
      ? csvPath
      : `https://www.uscis.gov${csvPath}`;
    const csvContent = await fetchText(csvUrl);

    const sponsors = parseH1bEmployerCsv(csvContent);
    if (sponsors.length === 0) {
      throw new Error("US H-1B employer CSV appears empty or invalid");
    }

    return sponsors;
  },
};

export default manifest;
