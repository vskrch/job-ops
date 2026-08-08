import { describe, expect, it } from "vitest";
import { extractJsonLdJobPostings, isHtmlText } from "./structured";

const JOB_POSTING_HTML = `<!doctype html>
<html>
<head>
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "JobPosting",
  "title": "Senior Backend Engineer",
  "url": "https://example.com/jobs/senior-backend-123",
  "datePosted": "2026-07-20",
  "employmentType": "FULL_TIME",
  "hiringOrganization": { "@type": "Organization", "name": "Acme Corp" },
  "jobLocation": {
    "@type": "Place",
    "address": {
      "@type": "PostalAddress",
      "addressLocality": "Austin",
      "addressRegion": "TX",
      "addressCountry": "US"
    }
  },
  "baseSalary": {
    "@type": "MonetaryAmount",
    "currency": "USD",
    "value": { "@type": "QuantitativeValue", "value": 180000, "unitText": "YEAR" }
  },
  "description": "Build reliable systems at scale."
}
</script>
</head>
<body></body>
</html>`;

describe("extractJsonLdJobPostings", () => {
  it("extracts a single JobPosting from HTML", () => {
    const postings = extractJsonLdJobPostings(JOB_POSTING_HTML);
    expect(postings).toHaveLength(1);
    expect(postings[0]).toMatchObject({
      title: "Senior Backend Engineer",
      employer: "Acme Corp",
      url: "https://example.com/jobs/senior-backend-123",
      location: "Austin, TX, US",
      salary: "180000 USD per YEAR",
      datePosted: "2026-07-20",
      employmentType: "FULL_TIME",
      description: "Build reliable systems at scale.",
    });
  });

  it("extracts multiple postings from an ItemList", () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@type":"ItemList","itemListElement":[
        {"@type":"JobPosting","title":"Job A","url":"https://x.com/a"},
        {"@type":"JobPosting","title":"Job B","url":"https://x.com/b"}
      ]}
    </script>`;
    const postings = extractJsonLdJobPostings(html);
    expect(postings).toHaveLength(2);
    expect(postings.map((p) => p.title)).toEqual(["Job A", "Job B"]);
  });

  it("extracts postings from a @graph", () => {
    const html = `<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"WebSite","name":"Board"},
        {"@type":"JobPosting","title":"Graph Job","url":"https://x.com/g"}
      ]}
    </script>`;
    const postings = extractJsonLdJobPostings(html);
    expect(postings).toHaveLength(1);
    expect(postings[0].title).toBe("Graph Job");
  });

  it("skips malformed JSON and non-JobPosting blocks", () => {
    const html = `
      <script type="application/ld+json">{ not json }</script>
      <script type="application/ld+json">{"@type":"Organization","name":"Acme"}</script>
      <script type="application/ld+json">{"@type":"JobPosting"}</script>
    `;
    const postings = extractJsonLdJobPostings(html);
    expect(postings).toHaveLength(1);
    expect(postings[0].title).toBeUndefined();
  });

  it("handles string jobLocation and missing optional fields", () => {
    const html = `<script type="application/ld+json">
      {"@type":"JobPosting","title":"Remote Dev","jobLocation":"Remote"}
    </script>`;
    const postings = extractJsonLdJobPostings(html);
    expect(postings[0]).toMatchObject({
      title: "Remote Dev",
      location: "Remote",
    });
    expect(postings[0].employer).toBeUndefined();
  });

  it("returns an empty array for markdown text", () => {
    expect(extractJsonLdJobPostings("# no html here")).toEqual([]);
  });

  it("recognizes HTML vs markdown bodies", () => {
    expect(isHtmlText("<!doctype html><body></body>", "text/html")).toBe(true);
    expect(isHtmlText("# Title", "text/plain")).toBe(false);
  });
});
