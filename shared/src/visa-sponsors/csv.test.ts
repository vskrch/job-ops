import { describe, expect, it } from "vitest";
import { parseCsvRows, parseVisaSponsorsCsv } from "./csv";

describe("parseVisaSponsorsCsv", () => {
  it("parses CRLF files and strips a UTF-8 BOM", () => {
    const csv = [
      "\uFEFFOrganisation Name,Town/City,County,Type & Rating,Route",
      '"Acme Ltd","London","Greater London","Worker","Skilled Worker"',
      '"Beta Corp","Manchester","Greater Manchester","Temporary","Graduate"\r',
    ].join("\r\n");

    expect(parseVisaSponsorsCsv(csv)).toEqual([
      {
        organisationName: "Acme Ltd",
        townCity: "London",
        county: "Greater London",
        typeRating: "Worker",
        route: "Skilled Worker",
      },
      {
        organisationName: "Beta Corp",
        townCity: "Manchester",
        county: "Greater Manchester",
        typeRating: "Temporary",
        route: "Graduate",
      },
    ]);
  });
});

describe("parseCsvRows", () => {
  it("preserves quoted commas and skips blank lines", () => {
    const csv = [
      "Employer,City,State",
      '"Acme, Inc.","New York, NY",NY',
      '"Beta Corp",Chicago,IL',
      "",
    ].join("\n");

    expect(parseCsvRows(csv)).toEqual([
      ["Employer", "City", "State"],
      ["Acme, Inc.", "New York, NY", "NY"],
      ["Beta Corp", "Chicago", "IL"],
    ]);
  });

  it("handles double-quoted quotes inside fields", () => {
    const csv = '"She said ""hi""",A,B';

    expect(parseCsvRows(csv)).toEqual([['She said "hi"', "A", "B"]]);
  });
});
