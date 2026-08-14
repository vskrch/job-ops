import { describe, expect, it } from "vitest";
import { runTheMuse } from "../src/run";

describe("The Muse Extractor", () => {
  it("parses themuse response correctly", async () => {
    const mockPayload = {
      page: 1,
      page_count: 1,
      total: 1,
      results: [
        {
          id: 45678,
          name: "Senior Distributed Systems Engineer",
          contents:
            "<p>We are seeking an engineer experienced with Go, Kafka, and Kubernetes.</p>",
          publication_date: "2026-08-11T10:00:00Z",
          levels: [{ name: "Senior Level", short_name: "senior" }],
          locations: [{ name: "Remote" }],
          categories: [{ name: "Software Engineering" }],
          company: { name: "CloudScale Inc", short_name: "cloudscale" },
          refs: {
            landing_page:
              "https://www.themuse.com/jobs/cloudscale/senior-distributed-systems-engineer",
          },
        },
      ],
    };

    const mockFetch = async () =>
      new Response(JSON.stringify(mockPayload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const result = await runTheMuse({
      searchTerms: ["systems"],
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("Senior Distributed Systems Engineer");
    expect(result.jobs[0].employer).toBe("CloudScale Inc");
    expect(result.jobs[0].jobLevel).toBe("Senior Level");
    expect(result.jobs[0].isRemote).toBe(true);
  });
});
