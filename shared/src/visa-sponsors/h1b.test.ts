import { describe, expect, it } from "vitest";
import {
  extractH1bEmployerCsvUrls,
  mergeH1bEmployerYears,
  parseH1bEmployerCsv,
} from "./h1b";

describe("extractH1bEmployerCsvUrls", () => {
  const html = [
    '<a href="/sites/default/files/document/data/h1b_datahubexport-2021.csv">2021</a>',
    '<a href="/sites/default/files/document/data/h1b_datahubexport-2023.csv">2023</a>',
    '<a href="/sites/default/files/document/data/h1b_datahubexport-2022.csv">2022</a>',
  ].join("\n");

  it("returns the newest years first", () => {
    expect(extractH1bEmployerCsvUrls(html)).toEqual([
      "/sites/default/files/document/data/h1b_datahubexport-2023.csv",
      "/sites/default/files/document/data/h1b_datahubexport-2022.csv",
      "/sites/default/files/document/data/h1b_datahubexport-2021.csv",
    ]);
  });

  it("respects maxYears and returns fewer when fewer exist", () => {
    expect(extractH1bEmployerCsvUrls(html, 2)).toEqual([
      "/sites/default/files/document/data/h1b_datahubexport-2023.csv",
      "/sites/default/files/document/data/h1b_datahubexport-2022.csv",
    ]);
    expect(extractH1bEmployerCsvUrls(html, 10)).toHaveLength(3);
  });

  it("returns an empty array when no H-1B CSV links exist", () => {
    expect(
      extractH1bEmployerCsvUrls("<html><body>no links</body></html>"),
    ).toEqual([]);
  });
});

describe("parseH1bEmployerCsv", () => {
  const csv = [
    '"Fiscal Year",Employer,"Initial Approval","Initial Denial","Continuing Approval","Continuing Denial",NAICS,"Tax ID",State,City,ZIP',
    '2023,"Acme, Inc.",1,0,2,0,51,1001,NY,"New York, NY",10001',
    "2023,3M COMPANY,0,0,1,0,33,2002,MN,ST PAUL,55144",
    "2023,,1,0,0,0,51,8070,DE,WILMINGTON,19801",
    '2023,"Acme, Inc.",1,0,2,0,51,1001,NY,"New York, NY",10001',
  ].join("\n");

  it("maps rows to sponsors and skips empty or duplicate employers", () => {
    const sponsors = parseH1bEmployerCsv(csv);

    expect(sponsors).toEqual([
      {
        organisationName: "Acme, Inc.",
        townCity: "New York, NY",
        county: "NY",
        typeRating: "NAICS 51",
        route: "H-1B (FY2023)",
      },
      {
        organisationName: "3M COMPANY",
        townCity: "ST PAUL",
        county: "MN",
        typeRating: "NAICS 33",
        route: "H-1B (FY2023)",
      },
    ]);
  });

  it("throws when the Employer column is missing", () => {
    expect(() => parseH1bEmployerCsv("Company,City\nAcme,NYC")).toThrow(
      /missing the 'Employer' column/,
    );
  });
});

describe("mergeH1bEmployerYears", () => {
  it("drops newer-year duplicates and keeps the most recent route label", () => {
    const fy2022 = [
      {
        organisationName: "Acme, Inc.",
        townCity: "New York, NY",
        county: "NY",
        typeRating: "NAICS 51",
        route: "H-1B (FY2022)",
      },
    ];
    const fy2023 = [
      {
        organisationName: "Acme, Inc.",
        townCity: "New York, NY",
        county: "NY",
        typeRating: "NAICS 51",
        route: "H-1B (FY2023)",
      },
      {
        organisationName: "3M COMPANY",
        townCity: "ST PAUL",
        county: "MN",
        typeRating: "NAICS 33",
        route: "H-1B (FY2023)",
      },
    ];

    expect(mergeH1bEmployerYears([fy2023, fy2022])).toEqual([
      {
        organisationName: "Acme, Inc.",
        townCity: "New York, NY",
        county: "NY",
        typeRating: "NAICS 51",
        route: "H-1B (FY2023)",
      },
      {
        organisationName: "3M COMPANY",
        townCity: "ST PAUL",
        county: "MN",
        typeRating: "NAICS 33",
        route: "H-1B (FY2023)",
      },
    ]);
  });
});
