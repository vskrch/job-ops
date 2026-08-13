import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./llm/service", () => ({
  LlmService: class {
    async callJson<T>() {
      const data = (globalThis as unknown as { __mockLlmData?: T })
        .__mockLlmData;
      if (!data) return { success: false, error: "mocked failure" };
      return { success: true, data };
    }
  },
}));

vi.mock("./modelSelection", () => ({
  resolveLlmRuntimeSettings: vi.fn(async () => ({ model: "test-model" })),
}));

// The PDF text extractor runs as a child process; fake its execFile plumbing.
type ExecFileOutcome =
  | "success"
  | "killed"
  | "spawnMissing"
  | "exit"
  | "parseFailure"
  | "emptyText"
  | "garbage";

vi.mock("node:child_process", () => {
  const execFileMock = (
    _cmd: string,
    _args: string[],
    _opts: unknown,
    cb: (
      error:
        | (Error & {
            code?: string | number;
            killed?: boolean;
            signal?: string;
          })
        | null,
      stdout: string,
      stderr: string,
    ) => void,
  ) => {
    const state = globalThis as unknown as {
      __mockExecFileGate?: Promise<void>;
      __mockExecFileOutcome?: ExecFileOutcome;
    };
    const outcome = state.__mockExecFileOutcome ?? "success";
    const respond = () => {
      switch (outcome) {
        case "killed": {
          const error = new Error("ETIMEDOUT") as Error & { killed: boolean };
          error.killed = true;
          cb(error, "", "");
          return;
        }
        case "spawnMissing": {
          const error = new Error("spawn node ENOENT") as Error & {
            code: string;
          };
          error.code = "ENOENT";
          cb(error, "", "");
          return;
        }
        case "exit": {
          const error = new Error("exited") as Error & { code: number };
          error.code = 1;
          cb(error, "", "boom");
          return;
        }
        case "parseFailure":
          cb(
            null,
            JSON.stringify({ ok: false, error: "Invalid PDF structure." }),
            "",
          );
          return;
        case "emptyText":
          cb(null, JSON.stringify({ ok: true, text: "   \n\n " }), "");
          return;
        case "garbage":
          cb(null, "not json at all", "");
          return;
        default:
          cb(
            null,
            JSON.stringify({
              ok: true,
              text: "Jane Doe\nData Engineer\nPython, SQL, AWS",
            }),
            "",
          );
      }
    };
    if (state.__mockExecFileGate) {
      state.__mockExecFileGate.then(respond);
    } else {
      respond();
    }
  };
  return {
    execFile: execFileMock,
    default: { execFile: execFileMock },
  };
});

import { closeDb as getCloseDb } from "@server/db/index";
import {
  extractResumeText,
  parseResumeProfile,
  profileToResumeProfile,
} from "./resume-parser";

function setLlmData(data: unknown): void {
  (globalThis as unknown as { __mockLlmData?: unknown }).__mockLlmData = data;
}

function setExecFileGate(gate: Promise<void> | undefined): void {
  (
    globalThis as unknown as { __mockExecFileGate?: Promise<void> }
  ).__mockExecFileGate = gate;
}

function setExecFileOutcome(outcome: ExecFileOutcome): void {
  (
    globalThis as unknown as { __mockExecFileOutcome?: ExecFileOutcome }
  ).__mockExecFileOutcome = outcome;
}

const originalEnv = { ...process.env };

describe.sequential("resume-parser", () => {
  let tempDir: string;
  let closeDb: (() => void) | null = null;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-resume-test-"));
    process.env = {
      ...originalEnv,
      DATA_DIR: tempDir,
      NODE_ENV: "test",
      MODEL: "test-model",
    };
    await import("@server/db/migrate");
    closeDb = getCloseDb;
    setExecFileGate(undefined);
    setExecFileOutcome("success");
  });

  afterEach(async () => {
    if (closeDb) closeDb();
    closeDb = null;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("parses a structured profile from resume text via LLM", async () => {
    setLlmData({
      fullName: "Jane Doe",
      email: "jane@example.com",
      phone: "+44 7000 000000",
      location: "London, UK",
      headline: "Data Engineer",
      summary: "Data engineer with 5 years of experience.",
      skills: ["Python", "SQL", "AWS"],
      experience: [
        {
          company: "Acme",
          position: "Data Engineer",
          startDate: "2020-01",
          endDate: "2023-06",
          summary: "Built pipelines",
        },
      ],
      education: [
        {
          institution: "University of X",
          degree: "MSc Computer Science",
          startDate: "2014-09",
          endDate: "2016-06",
        },
      ],
      certifications: ["AWS Certified"],
      languages: ["English"],
      links: [{ label: "LinkedIn", url: "https://linkedin.com/in/jane" }],
    });

    const profile = await parseResumeProfile("Jane Doe ...");

    expect(profile.fullName).toBe("Jane Doe");
    expect(profile.skills).toEqual(["Python", "SQL", "AWS"]);
    expect(profile.experience[0]?.company).toBe("Acme");
    expect(profile.education[0]?.degree).toBe("MSc Computer Science");
    expect(profile.links[0]?.url).toBe("https://linkedin.com/in/jane");
  });

  it("throws an upstream error when the LLM call fails", async () => {
    setLlmData(undefined);
    await expect(parseResumeProfile("Jane Doe ...")).rejects.toThrow(
      /Could not extract a profile from the resume text/,
    );
  });

  it("normalizes malformed LLM output instead of crashing", async () => {
    setLlmData({
      fullName: 42,
      skills: "not-an-array",
      experience: [{ company: "Acme" }],
    });
    const profile = await parseResumeProfile("whatever");
    expect(profile.fullName).toBeNull();
    expect(profile.skills).toEqual([]);
    expect(profile.experience[0]?.company).toBe("Acme");
  });

  it("preserves discrete bullets when the LLM returns them", async () => {
    setLlmData({
      fullName: "Jane Doe",
      skills: [],
      experience: [
        {
          company: "Acme",
          position: "Data Engineer",
          summary: "Built data pipelines",
          bullets: [
            "Built 5 ETL pipelines processing 10TB daily",
            "Reduced query latency by 40%",
            "Mentored 3 junior engineers",
          ],
        },
      ],
      education: [],
      projects: [],
      certifications: [],
      languages: [],
      links: [],
      email: null,
      phone: null,
      location: null,
      headline: null,
    });
    const profile = await parseResumeProfile("whatever");
    expect(profile.experience[0]?.bullets).toEqual([
      "Built 5 ETL pipelines processing 10TB daily",
      "Reduced query latency by 40%",
      "Mentored 3 junior engineers",
    ]);
  });

  it("splits a single summary string into bullets when no bullets are returned", async () => {
    setLlmData({
      fullName: "Jane Doe",
      skills: [],
      experience: [
        {
          company: "Acme",
          position: "Engineer",
          summary:
            "Built ETL pipelines. Reduced query latency. Mentored juniors.",
          bullets: [],
        },
      ],
      education: [],
      projects: [],
      certifications: [],
      languages: [],
      links: [],
      email: null,
      phone: null,
      location: null,
      headline: null,
    });
    const profile = await parseResumeProfile("whatever");
    expect(profile.experience[0]?.bullets.length).toBeGreaterThan(1);
    // The combined summary still wins as fallback text.
    expect(profile.experience[0]?.summary).toContain("Built ETL");
  });

  it("preserves project bullets and education description", async () => {
    setLlmData({
      fullName: "Jane Doe",
      skills: [],
      experience: [],
      projects: [
        {
          name: "OpenSearch indexer",
          description: "Custom indexer for OpenSearch",
          bullets: [
            "Supports 100k docs/sec ingest",
            "Open source, 500+ GitHub stars",
          ],
        },
      ],
      education: [
        {
          institution: "University of X",
          degree: "MSc Computer Science",
          startDate: "2014",
          endDate: "2016",
          description: "GPA 3.9, Dean's List",
          grade: "3.9/4.0",
        },
      ],
      certifications: [],
      languages: [],
      links: [],
      email: null,
      phone: null,
      location: null,
      headline: null,
    });
    const profile = await parseResumeProfile("whatever");
    expect(profile.projects[0]?.bullets).toHaveLength(2);
    expect(profile.education[0]?.description).toBe("GPA 3.9, Dean's List");
    expect(profile.education[0]?.grade).toBe("3.9/4.0");
  });

  it("converts a lean profile to the base resume format", () => {
    const converted = profileToResumeProfile({
      fullName: "Jane Doe",
      headline: "Data Engineer",
      summary: "Summary text",
      skills: ["Python", "SQL"],
      experience: [
        {
          company: "Acme",
          position: "Data Engineer",
          startDate: "2020-01",
          endDate: "2023-06",
          summary: "Built pipelines",
          bullets: [],
        },
      ],
      email: null,
      phone: null,
      location: "London",
      education: [],
      projects: [],
      certifications: [],
      languages: [],
      links: [],
    });

    expect(converted.basics?.name).toBe("Jane Doe");
    expect(converted.basics?.label).toBe("Data Engineer");
    expect(converted.basics?.location?.address).toBe("London");
    expect(
      (
        converted.sections?.skills as { items: Array<{ name: string }> }
      ).items.map((item) => item.name),
    ).toEqual(["Python", "SQL"]);
    expect(
      (
        converted.sections?.experience as {
          items: Array<{ position: string }>;
        }
      ).items[0]?.position,
    ).toBe("Data Engineer");
  });

  it("processes an upload end-to-end and persists the profile", async () => {
    setLlmData({
      fullName: "Jane Doe",
      email: "jane@example.com",
      phone: null,
      location: "London, UK",
      headline: "Data Engineer",
      summary: null,
      skills: ["Python", "SQL"],
      experience: [],
      education: [],
      certifications: [],
      languages: [],
      links: [],
    });

    // Dynamic import: the DB-touching path must use the fresh module
    // registry created in beforeEach (vi.resetModules()).
    const { processResumeUpload: processUpload } = await import(
      "./resume-parser"
    );

    const { profile, baseResume } = await processUpload(
      join(tempDir, "fake-resume.pdf"),
      "resume.pdf",
    );

    expect(profile.id).toBeTruthy();
    expect(profile.fullName).toBe("Jane Doe");
    expect(profile.fileName).toBe("resume.pdf");
    expect(profile.skills).toEqual(["Python", "SQL"]);
    expect(baseResume.basics?.name).toBe("Jane Doe");
  });

  it("rejects a concurrent upload while another is parsing", async () => {
    setLlmData({
      fullName: "Jane Doe",
      email: "jane@example.com",
      phone: null,
      location: "London, UK",
      headline: "Data Engineer",
      summary: null,
      skills: ["Python", "SQL"],
      experience: [],
      education: [],
      certifications: [],
      languages: [],
      links: [],
    });

    let releaseGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });
    setExecFileGate(gate);

    const { processResumeUpload: processUpload } = await import(
      "./resume-parser"
    );

    const first = processUpload(join(tempDir, "fake-resume.pdf"), "resume.pdf");
    await expect(
      processUpload(join(tempDir, "fake-resume-2.pdf"), "resume.pdf"),
    ).rejects.toMatchObject({
      status: 409,
    });

    releaseGate();
    const result = await first;
    expect(result.profile.fullName).toBe("Jane Doe");

    // The lock is released after the first parse finishes.
    await expect(
      processUpload(join(tempDir, "fake-resume-3.pdf"), "resume.pdf"),
    ).resolves.toMatchObject({
      profile: { fullName: "Jane Doe" },
    });
  });

  it("maps extractor failure modes onto the API error contract", async () => {
    const { extractResumeText: extract } = await import("./resume-parser");
    const path = join(tempDir, "fake.pdf");

    setExecFileOutcome("killed");
    await expect(extract(path)).rejects.toMatchObject({
      status: 408,
      code: "REQUEST_TIMEOUT",
    });

    setExecFileOutcome("spawnMissing");
    await expect(extract(path)).rejects.toMatchObject({
      status: 502,
      code: "UPSTREAM_ERROR",
    });

    setExecFileOutcome("exit");
    await expect(extract(path)).rejects.toMatchObject({
      status: 502,
      code: "UPSTREAM_ERROR",
    });

    setExecFileOutcome("parseFailure");
    await expect(extract(path)).rejects.toMatchObject({
      status: 422,
      code: "UNPROCESSABLE_ENTITY",
    });

    setExecFileOutcome("emptyText");
    await expect(extract(path)).rejects.toMatchObject({
      status: 422,
      code: "UNPROCESSABLE_ENTITY",
    });

    setExecFileOutcome("garbage");
    await expect(extract(path)).rejects.toMatchObject({
      status: 502,
      code: "UPSTREAM_ERROR",
    });

    setExecFileOutcome("success");
    await expect(extract(path)).resolves.toContain("Jane Doe");
  });
});
