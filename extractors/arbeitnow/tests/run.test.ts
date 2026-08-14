import { describe, expect, it } from "vitest";
import { runArbeitnow } from "../src/run";

describe("Arbeitnow Extractor", () => {
  it("parses arbeitnow response correctly", async () => {
    const mockJobs = [
      {
        slug: "senior-go-developer-123",
        company_name: "EuroCloud GmbH",
        title: "Senior Go Developer",
        description:
          "<p>Build scalable microservices with Go and Kubernetes.</p>",
        remote: true,
        url: "https://www.arbeitnow.com/jobs/companies/eurocloud/senior-go-developer-123",
        tags: ["Go", "Kubernetes", "gRPC"],
        job_types: ["Full Time"],
        location: "Berlin / Remote",
        created_at: 1723500000,
      },
    ];

    const mockFetch = async () =>
      new Response(JSON.stringify({ data: mockJobs }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });

    const result = await runArbeitnow({
      searchTerms: ["Go"],
      fetchImpl: mockFetch as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].title).toBe("Senior Go Developer");
    expect(result.jobs[0].employer).toBe("EuroCloud GmbH");
    expect(result.jobs[0].skills).toBe("Go, Kubernetes, gRPC");
    expect(result.jobs[0].isRemote).toBe(true);
  });
});
