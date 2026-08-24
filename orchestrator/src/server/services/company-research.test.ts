import { describe, expect, it } from "vitest";
import { isFresh, normalizeCompanyKey } from "./company-research";

describe("normalizeCompanyKey", () => {
  it("strips legal suffixes and lowercases", () => {
    expect(normalizeCompanyKey("Acme Inc.")).toBe("acme");
    expect(normalizeCompanyKey("Novo Nordisk A/S")).toBe("novo-nordisk");
  });
  it("collapses punctuation and whitespace", () => {
    expect(normalizeCompanyKey("  Foo — Bar  ")).toBe("foo-bar");
  });
});

describe("isFresh", () => {
  it("treats a fresh timestamp as fresh", () => {
    expect(isFresh(new Date().toISOString())).toBe(true);
  });
  it("treats an old timestamp as stale", () => {
    expect(isFresh("2020-01-01T00:00:00.000Z")).toBe(false);
  });
  it("honors a custom TTL", () => {
    const recentMs = Date.now() - 1000;
    const fetchedAt = new Date(recentMs).toISOString();
    expect(isFresh(fetchedAt, 500)).toBe(false);
    expect(isFresh(fetchedAt, 5000)).toBe(true);
  });
});
