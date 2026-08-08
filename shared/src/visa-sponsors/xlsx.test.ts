import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseXlsxFirstSheet } from "./xlsx";

const FIXTURE_PATH = join(__dirname, "__fixtures__", "lmia-employers.xlsx");

describe("parseXlsxFirstSheet", () => {
  it("parses a shared-strings workbook into rows of cell values", () => {
    const buffer = readFileSync(FIXTURE_PATH);
    const rows = parseXlsxFirstSheet(new Uint8Array(buffer));

    expect(rows).toEqual([
      ["Title row"],
      [
        "Province/Territory",
        "Program Stream",
        "Employer",
        "Address",
        "Occupation",
        "Incorporate Status",
        "Approved LMIAs",
        "Approved Positions",
      ],
      [
        "Ontario",
        "High Wage",
        "Acme Tech Inc",
        "Toronto, ON M5H 2N2",
        "21231-Software engineers",
        "Corporation",
        1,
        2,
      ],
      [
        "Quebec",
        "Low Wage",
        "Beta Foods Inc",
        "Montreal, QC H2X 1Y4",
        "62020-Food service supervisors",
        "Unknown",
        1,
        2,
      ],
      [
        "Ontario",
        "High Wage",
        "Acme Tech Inc",
        "Ottawa, ON K1A 0B1",
        "21231-Software engineers",
        "Corporation",
        1,
        2,
      ],
    ]);
  });

  it("throws a clear error for non-xlsx input", () => {
    const garbage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
    expect(() => parseXlsxFirstSheet(garbage)).toThrow(
      /end-of-central-directory|corrupt/,
    );
  });
});
