import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getLatexTemplatePath,
  getTectonicBinary,
  readLatexTemplate,
  renderLatexPdf,
} from "./latex";
import type { LatexResumeDocument } from "./types";

const baseDocument: LatexResumeDocument = {
  name: "Jane Doe",
  headline: "Senior Software Engineer",
  contactItems: [
    { text: "jane@example.com", url: "mailto:jane@example.com" },
    { text: "Portfolio", url: "https://jane.dev" },
  ],
  summary: "Builds resilient platform systems.",
  experience: [
    {
      title: "Acme",
      subtitle: "Platform Engineer | Remote",
      date: "2023 -- Present",
      bullets: ["Improved API reliability", "Reduced operator toil"],
      url: "https://acme.example.com",
      linkLabel: "Acme",
    },
  ],
  education: [],
  projects: [],
  skillGroups: [
    {
      name: "Backend",
      keywords: ["TypeScript", "Node.js", "PostgreSQL"],
    },
  ],
};

async function createTempDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "job-ops-latex-render-test-"));
}

function tectonicAvailable(): boolean {
  const binary = process.env.TECTONIC_BIN?.trim() || "tectonic";
  const result = spawnSync(binary, ["--version"], { stdio: "ignore" });
  return result.status === 0;
}

describe("latex resume renderer", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });

  it("exposes the bundled Charter template as default", async () => {
    expect(getLatexTemplatePath()).toContain("charter-resume.tex");
    expect(getLatexTemplatePath("charter")).toContain("charter-resume.tex");
    const template = await readLatexTemplate("charter");
    expect(template).toContain("Charter Single-Column Clean Resume");
    expect(template).toContain("__BODY__");
  });

  it("exposes the bundled Jake template", async () => {
    expect(getLatexTemplatePath("jake")).toContain("jake-resume.tex");
    const template = await readLatexTemplate("jake");
    expect(template).toContain("Resume in Latex");
    expect(template).toContain("__BODY__");
  });

  it("exposes the Modern template", async () => {
    expect(getLatexTemplatePath("modern")).toContain("modern-resume.tex");
    const template = await readLatexTemplate("modern");
    expect(template).toContain("__BODY__");
    expect(template).toContain("__NAME__");
  });

  it("falls back to Charter for unknown template ids", async () => {
    expect(getLatexTemplatePath("nonexistent" as never)).toContain(
      "charter-resume.tex",
    );
  });

  it("uses the TECTONIC_BIN override when present", () => {
    const previous = process.env.TECTONIC_BIN;
    process.env.TECTONIC_BIN = "/tmp/custom-tectonic";
    expect(getTectonicBinary()).toBe("/tmp/custom-tectonic");
    if (previous === undefined) {
      delete process.env.TECTONIC_BIN;
    } else {
      process.env.TECTONIC_BIN = previous;
    }
  });

  it("fails with a helpful error when tectonic is unavailable", async () => {
    const previous = process.env.TECTONIC_BIN;
    process.env.TECTONIC_BIN = "/definitely/missing/tectonic";
    const tempDir = await createTempDir();
    tempDirs.push(tempDir);
    const outputPath = join(tempDir, "resume.pdf");

    await expect(
      renderLatexPdf({
        document: baseDocument,
        outputPath,
        jobId: "job-missing-tectonic",
      }),
    ).rejects.toThrow(/Tectonic binary not found/i);

    if (previous === undefined) {
      delete process.env.TECTONIC_BIN;
    } else {
      process.env.TECTONIC_BIN = previous;
    }
  });

  it.skipIf(!tectonicAvailable())(
    "renders a PDF with the Charter template when tectonic is installed",
    async () => {
      const tempDir = await createTempDir();
      tempDirs.push(tempDir);
      const outputPath = join(tempDir, "resume_charter.pdf");

      await renderLatexPdf({
        document: baseDocument,
        outputPath,
        jobId: "job-charter-success",
        templateId: "charter",
      });

      const stats = spawnSync("sh", ["-lc", `test -s "${outputPath}"`], {
        stdio: "ignore",
      });
      expect(stats.status).toBe(0);
    },
  );

  it.skipIf(!tectonicAvailable())(
    "renders a PDF with the Jake template when tectonic is installed",
    async () => {
      const tempDir = await createTempDir();
      tempDirs.push(tempDir);
      const outputPath = join(tempDir, "resume_jake.pdf");

      await renderLatexPdf({
        document: baseDocument,
        outputPath,
        jobId: "job-jake-success",
        templateId: "jake",
      });

      const stats = spawnSync("sh", ["-lc", `test -s "${outputPath}"`], {
        stdio: "ignore",
      });
      expect(stats.status).toBe(0);
    },
  );

  it.skipIf(!tectonicAvailable())(
    "renders a PDF with a custom user-provided LaTeX template",
    async () => {
      const tempDir = await createTempDir();
      tempDirs.push(tempDir);
      const outputPath = join(tempDir, "resume_custom.pdf");

      const customTemplate = `
\\documentclass[10.5pt]{article}
\\usepackage[letterpaper,top=0.4in,bottom=0.4in,left=0.5in,right=0.5in]{geometry}
\\usepackage{charter}
\\usepackage[T1]{fontenc}
\\usepackage[utf8]{inputenc}
\\usepackage{enumitem}
\\usepackage[hidelinks]{hyperref}
\\usepackage{titlesec}
\\usepackage{iftex}
\\raggedright
\\pagestyle{empty}

\\titleformat{\\section}{\\bfseries\\large}{}{0pt}{}[\\vspace{1pt}\\titlerule\\vspace{-6.5pt}]

\\begin{document}
\\centerline{\\Huge __NAME__}
\\vspace{5pt}
\\centerline{__CONTACT_BLOCK__}
\\vspace{-10pt}

__BODY__

\\end{document}
`;

      await renderLatexPdf({
        document: baseDocument,
        outputPath,
        jobId: "job-custom-success",
        templateId: "custom",
        customTemplateContent: customTemplate,
      });

      const stats = spawnSync("sh", ["-lc", `test -s "${outputPath}"`], {
        stdio: "ignore",
      });
      expect(stats.status).toBe(0);
    },
  );
});
