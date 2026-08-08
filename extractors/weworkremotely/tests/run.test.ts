import { describe, expect, it, vi } from "vitest";
import { runWwr } from "../src/run";

function createTextResponse(xml: string): Response {
  return {
    ok: true,
    status: 200,
    text: async () => xml,
  } as Response;
}

const RSS = `<?xml version="1.0"?>
<rss version="2.0"><channel>
<item>
  <title>Acme: Senior Backend Engineer</title>
  <link>https://weworkremotely.com/remote-jobs/acme-senior-backend</link>
  <description>&lt;div&gt;Full-time, Worldwide&lt;/div&gt;&lt;p&gt;Build APIs.&lt;/p&gt;</description>
  <category>Dev</category>
  <pubDate>Tue, 04 Aug 2026 10:00:00 +0000</pubDate>
</item>
<item>
  <title>Beta: Product Designer</title>
  <link>https://weworkremotely.com/remote-jobs/beta-designer</link>
  <description>&lt;div&gt;USA only&lt;/div&gt;&lt;p&gt;Design things.&lt;/p&gt;</description>
  <category>Design</category>
  <pubDate>Wed, 05 Aug 2026 10:00:00 +0000</pubDate>
</item>
</channel></rss>`;

describe("runWwr", () => {
  it("parses RSS items and splits company from title", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createTextResponse(RSS));

    const result = await runWwr({
      searchTerms: [""],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toEqual(
      expect.objectContaining({
        source: "weworkremotely",
        title: "Senior Backend Engineer",
        employer: "Acme",
        location: "Remote",
        isRemote: true,
        listingType: "Dev",
      }),
    );
  });

  it("filters by country from the description", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createTextResponse(RSS));

    const result = await runWwr({
      searchTerms: [""],
      selectedCountry: "united states",
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(true);
    // Worldwide remote listings stay relevant for any selected country.
    expect(result.jobs.map((job) => job.employer).sort()).toEqual([
      "Acme",
      "Beta",
    ]);
  });

  it("returns success with an empty list on failure", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 500 } as Response);

    const result = await runWwr({
      searchTerms: [""],
      fetchImpl: fetchMock,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("500");
  });
});
