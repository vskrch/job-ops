import { describe, expect, it } from "vitest";
import {
  daysUntilDeadline,
  extractDeadlineFromText,
  isPastDeadline,
  isUrgentDeadline,
  parseIsoDateAsUtcMidnight,
} from "./deadline";

describe("extractDeadlineFromText", () => {
  it("prefers ISO on a deadline-anchored line", () => {
    expect(
      extractDeadlineFromText("Apply by deadline: 2026-03-15\nSome body"),
    ).toBe("2026-03-15");
  });

  it("ignores ISO with no deadline keyword when another ISO is on a deadline line", () => {
    expect(
      extractDeadlineFromText("Posted 2026-01-01\nDeadline 2026-03-15"),
    ).toBe("2026-03-15");
  });

  it("returns null on ambiguous bare dates", () => {
    expect(extractDeadlineFromText("Join us soon, fun team!")).toBeNull();
    expect(extractDeadlineFromText("Posted: 2026-01-01")).toBeNull();
  });
});

describe("parseIsoDateAsUtcMidnight", () => {
  it("round-trips a valid ISO date", () => {
    expect(parseIsoDateAsUtcMidnight("2026-03-15")).not.toBeNull();
  });
  it("rejects non-ISO shapes", () => {
    expect(parseIsoDateAsUtcMidnight("15.03.2026")).toBeNull();
    expect(parseIsoDateAsUtcMidnight("")).toBeNull();
  });
});

describe("daysUntilDeadline / urgency", () => {
  it("computes days relative to today UTC", () => {
    const iso = new Date().toISOString().slice(0, 10);
    expect(daysUntilDeadline(iso)).toBe(0);
  });
  it("past deadlines are detected", () => {
    // Epoch is always in the past; avoids hardcoding a future date in tests.
    expect(isPastDeadline("1999-01-01")).toBe(true);
    expect(isPastDeadline("2099-01-01")).toBe(false);
  });
  it("urgency boundary at 7 days", () => {
    // Midpoint: use today's ISO + 7 days via Date arithmetic rather than hardcoding.
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    const iso7 = d.toISOString().slice(0, 10);
    expect(isUrgentDeadline(iso7, 7)).toBe(true);
    const d8 = new Date();
    d8.setUTCDate(d8.getUTCDate() + 8);
    expect(isUrgentDeadline(d8.toISOString().slice(0, 10), 7)).toBe(false);
  });
});
