import { describe, expect, it, vi } from "vitest";
import { parseJobHeader, runHnHiring } from "../src/run";

function createResponse(payload: unknown, _isHtml = false): Response {
  return {
    ok: true,
    status: 200,
    text: async () =>
      typeof payload === "string" ? payload : JSON.stringify(payload),
    json: async () => payload,
  } as Response;
}

const THREAD_SEARCH = {
  hits: [{ objectID: "12345", title: "Ask HN: Who is hiring? (August 2026)" }],
};

const THREAD_ITEM = {
  objectID: "12345",
  created_at: "2026-08-01T10:00:00.000Z",
  children: [
    {
      objectID: "101",
      created_at: "2026-08-01T10:00:00.000Z",
      text: [
        "Acme Corp | Senior Backend Engineer | Remote (USA) | Full-time | $160k - $210k",
        "We are looking for a senior backend engineer to build scalable distributed services.",
        "Apply at: https://acme.example/jobs/engineer",
      ].join("<p>"),
    },
    {
      objectID: "102",
      created_at: "2026-08-01T11:00:00.000Z",
      text: [
        "Beta Design | Product Designer | London, UK | Onsite",
        "Join our design team in central London.",
        "Contact: design@beta.example",
      ].join("<p>"),
    },
    {
      objectID: "103",
      created_at: "2026-08-01T12:00:00.000Z",
      text: [
        "Gamma Cloud | DevOps Engineer | Bangalore, India | Hybrid | 25 LPA",
        "We are hiring a DevOps engineer experienced in Kubernetes and AWS.",
        "Apply: https://gamma.example/jobs/devops",
      ].join("<p>"),
    },
  ],
};

const HNHIRING_HOME_HTML = `
<!DOCTYPE html>
<html>
<body>
  <h1>All Jobs From Hacker News 'Who is Hiring?' Posts | HNHIRING</h1>
  <p><a href="/august-2026">August 2026</a></p>
</body>
</html>
`;

const HNHIRING_MONTH_HTML = `
<!DOCTYPE html>
<html>
<body>
  <ul>
    <li>
      <a href="https://news.ycombinator.com/user?id=alex">alex</a> about 2 hours ago
      Delta Labs | AI Platform Engineer | San Francisco, CA | Full-Time | $180k-$240k
      Building autonomous agent infrastructure. Apply at https://delta.example/apply
    </li>
  </ul>
</body>
</html>
`;

describe("parseJobHeader", () => {
  it("parses pipe-delimited format", () => {
    const parsed = parseJobHeader(
      "ResortPass | Senior Frontend Engineer | New York, NY | $160k-$210k",
    );
    expect(parsed.employer).toBe("ResortPass");
    expect(parsed.title).toBe("Senior Frontend Engineer");
    expect(parsed.location).toBe("New York, NY");
    expect(parsed.salary).toBe("$160k-$210k");
  });

  it("parses natural language 'is hiring' format", () => {
    const parsed = parseJobHeader(
      "Acme Robotics is hiring a Senior Firmware Engineer (Remote)",
    );
    expect(parsed.employer).toBe("Acme Robotics");
    expect(parsed.title).toBe("Senior Firmware Engineer");
    expect(parsed.isRemote).toBe(true);
  });
});

describe("runHnHiring", () => {
  it("scrapes jobs from hnhiring.com and HN Algolia API", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (
        urlStr === "https://hnhiring.com" ||
        urlStr === "https://hnhiring.com/"
      ) {
        return createResponse(HNHIRING_HOME_HTML, true);
      }
      if (
        urlStr.includes("august-2026") ||
        urlStr.includes("locations/remote")
      ) {
        return createResponse(HNHIRING_MONTH_HTML, true);
      }
      if (urlStr.includes("api/v1/search")) {
        return createResponse(THREAD_SEARCH);
      }
      if (urlStr.includes("api/v1/items/12345")) {
        return createResponse(THREAD_ITEM);
      }
      return createResponse({ hits: [] });
    });

    const result = await runHnHiring({
      searchTerms: ["engineer"],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(result.jobs.length).toBeGreaterThanOrEqual(3);
    const employers = result.jobs.map((j) => j.employer);
    expect(employers).toContain("Acme Corp");
    expect(employers).toContain("Delta Labs");
    expect(employers).toContain("Gamma Cloud");
  });

  it("filters by selected country", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const urlStr = String(url);
      if (urlStr.includes("hnhiring.com")) {
        return createResponse("", true);
      }
      if (urlStr.includes("api/v1/search")) {
        return createResponse(THREAD_SEARCH);
      }
      if (urlStr.includes("api/v1/items/12345")) {
        return createResponse(THREAD_ITEM);
      }
      return createResponse({ hits: [] });
    });

    const result = await runHnHiring({
      searchTerms: [""],
      selectedCountry: "india",
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    const employers = result.jobs.map((j) => j.employer);
    expect(employers).toContain("Gamma Cloud");
    expect(employers).not.toContain("Beta Design");
  });

  it("returns empty list when no threads or pages are found", async () => {
    const fetchMock = vi.fn(async () => createResponse({ hits: [] }));

    const result = await runHnHiring({
      searchTerms: [""],
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.success).toBe(true);
    expect(result.jobs).toHaveLength(0);
  });
});
