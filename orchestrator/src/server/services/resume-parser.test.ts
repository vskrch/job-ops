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

// Delegate to a per-test fake when configured, otherwise the real parser.
vi.mock("pdf-parse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("pdf-parse")>();
  return {
    PDFParse: function PdfParseProxy(options: { data: Buffer }) {
      const Fake = (
        globalThis as unknown as {
          __MockPDFParseClass?: new (options: {
            data: Buffer;
          }) => {
            getText(): Promise<{ text: string }>;
            destroy(): Promise<void>;
          };
        }
      ).__MockPDFParseClass;
      if (Fake) return new Fake(options);
      return new actual.PDFParse(options);
    },
  };
});

import { closeDb as getCloseDb } from "@server/db/index";
import {
  extractResumeText,
  parseResumeProfile,
  profileToResumeProfile,
} from "./resume-parser";

const TINY_PDF = Buffer.from(
  [
    "%PDF-1.4",
    "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj",
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj",
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj",
    "4 0 obj<</Length 44>>stream",
    "BT /F1 12 Tf 72 712 Td (Hello Resume World) Tj ET",
    "endstream endobj",
    "5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj",
    "trailer<</Root 1 0 R>>",
    "%%EOF",
  ].join("\n"),
);

class FakePDFParse {
  async getText(): Promise<{ text: string }> {
    return { text: "Jane Doe\nData Engineer\nPython, SQL, AWS" };
  }
  async destroy(): Promise<void> {}
}

class EmptyPDFParse {
  async getText(): Promise<{ text: string }> {
    return { text: "   \n\n  " };
  }
  async destroy(): Promise<void> {}
}

function stubPdfParse(fake: typeof FakePDFParse | typeof EmptyPDFParse): void {
  (
    globalThis as unknown as { __MockPDFParseClass?: unknown }
  ).__MockPDFParseClass = fake;
}

function setLlmData(data: unknown): void {
  (globalThis as unknown as { __mockLlmData?: unknown }).__mockLlmData = data;
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
    delete (globalThis as unknown as { __MockPDFParseClass?: unknown })
      .__MockPDFParseClass;
  });

  afterEach(async () => {
    if (closeDb) closeDb();
    closeDb = null;
    await rm(tempDir, { recursive: true, force: true });
  });

  it("extracts text from a real PDF buffer", async () => {
    const text = await extractResumeText(TINY_PDF);
    expect(text).toContain("Hello Resume World");
  });

  it("throws when no text can be extracted from a PDF", async () => {
    stubPdfParse(EmptyPDFParse);
    await expect(extractResumeText(Buffer.alloc(0))).rejects.toThrow(
      "No text could be extracted",
    );
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
        },
      ],
      email: null,
      phone: null,
      location: "London",
      education: [],
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
    stubPdfParse(FakePDFParse);
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
      Buffer.from("fake-pdf"),
      "resume.pdf",
    );

    expect(profile.id).toBeTruthy();
    expect(profile.fullName).toBe("Jane Doe");
    expect(profile.fileName).toBe("resume.pdf");
    expect(profile.skills).toEqual(["Python", "SQL"]);
    expect(baseResume.basics?.name).toBe("Jane Doe");
  });
});
