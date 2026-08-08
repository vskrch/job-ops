import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseLmiaEmployerRows } from "./lmia-xlsx";
import { parseXlsxFirstSheet } from "./xlsx";

const FIXTURE_PATH = join(__dirname, "__fixtures__", "lmia-employers.xlsx");

describe("parseLmiaEmployerRows", () => {
  it("maps workbook rows to sponsors, splitting address city and deduping", () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const rows = parseXlsxFirstSheet(new Uint8Array(buffer));
    const sponsors = parseLmiaEmployerRows(rows);

    expect(sponsors).toEqual([
      {
        organisationName: "Acme Tech Inc",
        townCity: "Toronto",
        county: "Ontario",
        typeRating: "High Wage",
        route: "21231-Software engineers",
      },
      {
        organisationName: "Beta Foods Inc",
        townCity: "Montreal",
        county: "Quebec",
        typeRating: "Low Wage",
        route: "62020-Food service supervisors",
      },
      {
        organisationName: "Acme Tech Inc",
        townCity: "Ottawa",
        county: "Ontario",
        typeRating: "High Wage",
        route: "21231-Software engineers",
      },
    ]);
  });

  it("throws when no employer header is present", () => {
    expect(() =>
      parseLmiaEmployerRows([
        ["A", "B"],
        ["1", "2"],
      ]),
    ).toThrow(/missing the 'Employer' header/);
  });
});
