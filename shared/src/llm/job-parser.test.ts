import { afterEach, describe, expect, it, vi } from "vitest";
import { llmParseJobs } from "./job-parser";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.unstubAllGlobals();
});

function mockChatCompletions(content: string, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: status >= 200 && status < 400,
      status,
      text: async () => (status >= 200 && status < 400 ? content : "down"),
      json: async () => ({
        choices: [
          {
            message: {
              content,
            },
          },
        ],
      }),
    })),
  );
}

describe("llmParseJobs", () => {
  it("returns null when no LLM is configured", async () => {
    delete process.env.LLM_BASE_URL;
    const jobs = await llmParseJobs({
      source: "dice",
      searchTerm: "developer",
      pageText: "some page",
    });
    expect(jobs).toBeNull();
  });

  it("parses a jobs array from the LLM response", async () => {
    process.env.LLM_BASE_URL = "https://example.com/v1";
    mockChatCompletions(
      JSON.stringify({
        jobs: [
          {
            title: "Backend Engineer",
            employer: "Acme",
            location: "Remote",
            salary: "$120k",
            jobType: "Full-time",
            jobUrl: "https://example.com/jobs/1",
            sourceJobId: "1",
            jobDescription: "Build things.",
          },
        ],
      }),
    );

    const jobs = await llmParseJobs({
      source: "dice",
      searchTerm: "developer",
      pageText: "page",
    });

    expect(jobs).toHaveLength(1);
    expect(jobs?.[0]).toMatchObject({
      source: "dice",
      title: "Backend Engineer",
      employer: "Acme",
      location: "Remote",
      salary: "$120k",
      jobDescription: "Build things.",
      jobUrl: "https://example.com/jobs/1",
    });
  });

  it("returns null on invalid JSON so callers keep regex results", async () => {
    process.env.LLM_BASE_URL = "https://example.com/v1";
    mockChatCompletions("not json at all");

    const jobs = await llmParseJobs({
      source: "eluta",
      searchTerm: "developer",
      pageText: "page",
    });

    expect(jobs).toBeNull();
  });

  it("returns null on provider errors", async () => {
    process.env.LLM_BASE_URL = "https://example.com/v1";
    mockChatCompletions("", 503);

    const jobs = await llmParseJobs({
      source: "dice",
      searchTerm: "developer",
      pageText: "page",
    });

    expect(jobs).toBeNull();
  });

  it("sends the OpenAI-compatible chat completions request", async () => {
    process.env.LLM_BASE_URL = "https://llm.example.com/v1";
    process.env.LLM_API_KEY = "sk-test";
    process.env.LLM_MODEL = "my-model";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        choices: [{ message: { content: '{"jobs": []}' } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await llmParseJobs({
      source: "dice",
      searchTerm: "developer",
      pageText: "page",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://llm.example.com/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as {
      model: string;
      response_format: { type: string };
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe("my-model");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0]?.role).toBe("system");
  });

  it("prefers the UI-provided config over env vars", async () => {
    process.env.LLM_BASE_URL = "https://env.example.com/v1";
    process.env.LLM_API_KEY = "sk-env";
    process.env.LLM_MODEL = "env-model";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => "",
      json: async () => ({
        choices: [{ message: { content: '{"jobs": []}' } }],
      }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await llmParseJobs({
      source: "dice",
      searchTerm: "developer",
      pageText: "page",
      llm: {
        baseUrl: "https://ui.example.com/v1",
        apiKey: "sk-ui",
        model: "ui-model",
      },
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://ui.example.com/v1/chat/completions");
    const body = JSON.parse(String(init.body)) as { model: string };
    expect(body.model).toBe("ui-model");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-ui");
  });
});
