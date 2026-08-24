import { createJob } from "@shared/testing/factories";
import { describe, expect, it } from "vitest";
import {
  daysSince,
  draftFollowUpText,
  followUpCountForJob,
  isQuietDue,
} from "./followups";

describe("followUp helpers", () => {
  it("daysSince rounds down to whole days", () => {
    const now = Date.UTC(2026, 3, 15);
    expect(daysSince(Date.UTC(2026, 3, 14), now)).toBe(1);
  });

  it("followUpCountForJob counts kind=followup metadata", () => {
    expect(
      followUpCountForJob([
        { metadata: JSON.stringify({ kind: "followup" }) },
        { metadata: JSON.stringify({ kind: "note" }) },
        { metadata: JSON.stringify({ kind: "followup" }) },
      ]),
    ).toBe(2);
  });

  it("isQuietDue respects threshold and max-2", () => {
    const now = Date.now();
    const tenDaysAgo = now - 10 * 86_400_000;
    expect(isQuietDue(tenDaysAgo, 0, now, 10)).toBe(true);
    expect(isQuietDue(tenDaysAgo, 0, now, 11)).toBe(false);
    expect(isQuietDue(tenDaysAgo, 2, now, 10)).toBe(false);
    expect(isQuietDue(null, 0, now, 10)).toBe(false);
  });

  it("draftFollowUpText is channel-shaped and within 60-120 words", () => {
    const job = createJob({
      title: "Senior Engineer",
      employer: "Acme",
      tailoredSummary: "Built streaming ETL in Kafka; cut latency 40%.",
    });
    const text = draftFollowUpText({
      job,
      channel: "email",
      contactPerson: "Alex",
      language: "en",
    });
    const words = text.split(/\s+/).filter(Boolean).length;
    expect(words).toBeGreaterThanOrEqual(60);
    expect(words).toBeLessThanOrEqual(120);
    expect(text).toContain("Acme");
  });
});
