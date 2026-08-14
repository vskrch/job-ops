import { describe, expect, it } from "vitest";
import { formatJobsToCsv } from "./csv-export";

describe("formatJobsToCsv", () => {
  it("formats jobs into valid CSV with headers and escaping", () => {
    const mockJobs = [
      {
        id: "job-1",
        title: "Senior Software Engineer, Core",
        employer: 'Acme "Tech" Inc',
        status: "ready",
        matchGrade: "A+",
        suitabilityScore: 92,
        suitabilityReason: "Strong fit for Python, distributed systems",
        location: "Toronto, ON",
        salary: "$140,000 - $180,000",
        jobType: "Full-time",
        source: "linkedin",
        jobUrl: "https://example.com/job/1",
        applicationLink: "https://example.com/job/1/apply",
        datePosted: "2026-08-10",
        discoveredAt: "2026-08-11",
      },
    ];

    const csv = formatJobsToCsv(mockJobs);
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("ID,Title,Employer,Status,Match Grade");
    expect(csv).toContain('"Senior Software Engineer, Core"');
    expect(csv).toContain('"Acme ""Tech"" Inc"');
    expect(csv).toContain('"Strong fit for Python, distributed systems"');
  });

  it("handles empty jobs array gracefully", () => {
    const csv = formatJobsToCsv([]);
    expect(csv).toContain("ID,Title,Employer");
  });
});
