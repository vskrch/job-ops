import type {
  VisaSponsor,
  VisaSponsorProviderManifest,
} from "@shared/types/visa-sponsors";
import { parseLmiaEmployerRows } from "@shared/visa-sponsors/lmia-xlsx";
import { parseXlsxFirstSheet } from "@shared/visa-sponsors/xlsx";

const DATASET_ID = "90fed587-1364-4f33-a9ee-208181dc0b97";
const DATASET_PAGE_URL = `https://open.canada.ca/data/en/dataset/${DATASET_ID}`;
const CKAN_API_URL = `https://open.canada.ca/data/api/3/action/package_show?id=${DATASET_ID}`;

const FETCH_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  accept: "application/json",
  referer: DATASET_PAGE_URL,
  origin: "https://open.canada.ca",
};

interface CkanResource {
  url: string;
}

function selectLatestPositiveLmiaXlsx(
  resources: CkanResource[],
): string | null {
  let bestUrl: string | null = null;
  let bestYear = 0;
  let bestQuarter = 0;

  for (const resource of resources) {
    const match = /tfwp_(\d{4})q([1-4])_pos_en\.xlsx$/i.exec(resource.url);
    if (!match) continue;

    const year = Number(match[1]);
    const quarter = Number(match[2]);
    if (year > bestYear || (year === bestYear && quarter > bestQuarter)) {
      bestYear = year;
      bestQuarter = quarter;
      bestUrl = resource.url;
    }
  }

  return bestUrl;
}

export const manifest: VisaSponsorProviderManifest = {
  id: "ca",
  displayName: "Canada",
  countryKey: "canada",
  scheduledUpdateHour: 4,

  async fetchSponsors(): Promise<VisaSponsor[]> {
    const apiResponse = await fetch(CKAN_API_URL, { headers: FETCH_HEADERS });
    if (!apiResponse.ok) {
      throw new Error(
        `Failed to query open.canada.ca: ${apiResponse.status} ${apiResponse.statusText}`,
      );
    }

    const payload = (await apiResponse.json()) as {
      result?: { resources?: CkanResource[] };
    };
    const resources = payload.result?.resources ?? [];
    const downloadUrl = selectLatestPositiveLmiaXlsx(resources);
    if (!downloadUrl) {
      throw new Error(
        "Could not find a positive LMIA employer workbook in open.canada.ca dataset",
      );
    }

    const fileResponse = await fetch(downloadUrl, { headers: FETCH_HEADERS });
    if (!fileResponse.ok) {
      throw new Error(
        `Failed to download LMIA employer list: ${fileResponse.status} ${fileResponse.statusText}`,
      );
    }

    const buffer = new Uint8Array(await fileResponse.arrayBuffer());
    const sponsors = parseLmiaEmployerRows(parseXlsxFirstSheet(buffer));
    if (sponsors.length === 0) {
      throw new Error("Canada LMIA employer list appears empty or invalid");
    }

    return sponsors;
  },
};

export default manifest;
