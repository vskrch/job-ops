import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { getSetting } from "@server/repositories/settings";
import type {
  LatexResumeContactItem,
  LatexResumeDocument,
  LatexResumeEntry,
  LatexTemplateId,
  ResumeRenderer,
} from "./types";

const TEMPLATE_FILES: Record<"charter" | "jake" | "modern", string> = {
  charter: "charter-resume.tex",
  jake: "jake-resume.tex",
  modern: "modern-resume.tex",
};

function resolveTemplatePath(templateId: LatexTemplateId): string {
  const fileName =
    templateId === "custom"
      ? TEMPLATE_FILES.charter
      : (TEMPLATE_FILES[templateId] ?? TEMPLATE_FILES.charter);
  try {
    if (import.meta.url.startsWith("file:")) {
      const modulePath = fileURLToPath(import.meta.url);
      const moduleRelativePath = join(modulePath, "..", "templates", fileName);
      if (existsSync(moduleRelativePath)) {
        return moduleRelativePath;
      }
    }
  } catch {
    // Fall through to cwd-based resolution below.
  }

  const cwd = process.cwd();
  if (cwd.endsWith("/orchestrator")) {
    return join(
      cwd,
      `src/server/services/resume-renderer/templates/${fileName}`,
    );
  }
  return join(
    cwd,
    `orchestrator/src/server/services/resume-renderer/templates/${fileName}`,
  );
}

const TECTONIC_TIMEOUT_MS = 120_000;
const OUTPUT_FILENAME = "resume.pdf";

function normalizeText(value: string): string {
  return value
    .replace(/\u2010|\u2011|\u2012|\u2013|\u2014/g, "-")
    .replace(/\u2022/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeLatexText(value: string): string {
  return normalizeText(value)
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function escapeLatexUrl(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "\\textbackslash{}")
    .replace(/([#$%&_{}])/g, "\\$1")
    .replace(/~/g, "\\textasciitilde{}")
    .replace(/\^/g, "\\textasciicircum{}");
}

function escapeForCommand(value: string): string {
  return escapeLatexText(value).replace(/\|/g, "{\\textbar}");
}

function renderLink(label: string, url?: string | null): string {
  if (!url) return escapeForCommand(label);
  return `\\href{${escapeLatexUrl(url)}}{\\underline{${escapeForCommand(label)}}}`;
}

function renderContactItems(items: LatexResumeContactItem[]): string {
  return items.map((item) => renderLink(item.text, item.url)).join(" $|$ ");
}

function renderBullets(items: string[]): string {
  if (items.length === 0) return "";
  return [
    "      \\resumeItemListStart",
    ...items.map((item) => `        \\resumeItem{${escapeForCommand(item)}}`),
    "      \\resumeItemListEnd",
  ].join("\n");
}

function renderSubheadingEntry(entry: LatexResumeEntry): string {
  const title = renderLink(entry.title, entry.url);
  const subtitle = entry.subtitle ? escapeForCommand(entry.subtitle) : "";
  const secondaryTitle = entry.secondaryTitle
    ? escapeForCommand(entry.secondaryTitle)
    : "";
  const secondarySubtitle = entry.secondarySubtitle
    ? escapeForCommand(entry.secondarySubtitle)
    : "";
  const date = entry.date ? escapeForCommand(entry.date) : "";

  const lines = [
    "    \\resumeSubheading",
    `      {${title}}{${date}}`,
    `      {${subtitle || secondaryTitle}}{${secondarySubtitle || ""}}`,
  ];

  const bullets = renderBullets(entry.bullets);
  if (bullets) lines.push(bullets);
  return lines.join("\n");
}

function renderProjectEntry(entry: LatexResumeEntry): string {
  const title = renderLink(entry.title, entry.url);
  const subtitle = entry.subtitle
    ? ` $|$ \\emph{${escapeForCommand(entry.subtitle)}}`
    : "";
  const date = entry.date ? escapeForCommand(entry.date) : "";
  const lines = [
    "      \\resumeProjectHeading",
    `          {\\textbf{${title}}${subtitle}}{${date}}`,
  ];
  const bullets = renderBullets(entry.bullets);
  if (bullets) lines.push(bullets);
  return lines.join("\n");
}

function renderCharterSubheadingEntry(entry: LatexResumeEntry): string {
  const title = renderLink(entry.title, entry.url);
  const subtitle = entry.subtitle
    ? `{${escapeForCommand(entry.subtitle)}}`
    : "";
  const date = entry.date ? escapeForCommand(entry.date) : "";
  const header = `\\textbf{${title},}${subtitle ? ` ${subtitle}` : ""} \\hfill ${date} \\\\`;
  const lines = [header, "\\vspace{-9pt}"];
  if (entry.bullets.length > 0) {
    lines.push(
      "\\begin{itemize}",
      ...entry.bullets.map((b) => `  \\item ${escapeForCommand(b)}`),
      "\\end{itemize}",
    );
  }
  return lines.join("\n");
}

function renderCharterEducationEntry(entry: LatexResumeEntry): string {
  const title = renderLink(entry.title, entry.url);
  const subtitle = entry.subtitle
    ? ` -- ${escapeForCommand(entry.subtitle)}`
    : "";
  const date = entry.date ? `\\hfill ${escapeForCommand(entry.date)}` : "";
  return `\\textbf{${title}}${subtitle} ${date}`;
}

function renderCharterProjectEntry(entry: LatexResumeEntry): string {
  const title = renderLink(entry.title, entry.url);
  const subtitle = entry.subtitle
    ? ` -- ${escapeForCommand(entry.subtitle)}`
    : "";
  const date = entry.date ? `\\hfill ${escapeForCommand(entry.date)}` : "";
  const lines = [
    `\\textbf{${title}}${subtitle} ${date} \\\\`,
    "\\vspace{-9pt}",
  ];
  if (entry.bullets.length > 0) {
    lines.push(
      "\\begin{itemize}",
      ...entry.bullets.map((b) => `  \\item ${escapeForCommand(b)}`),
      "\\end{itemize}",
    );
  }
  return lines.join("\n");
}

function renderSummarySection(
  document: LatexResumeDocument,
  isCharter = false,
): string {
  if (!document.summary) return "";
  if (isCharter) {
    return [
      "\\section*{Summary}",
      escapeForCommand(document.summary),
      "\\vspace{-6.5pt}",
      "",
    ].join("\n");
  }
  return [
    "\\section{Summary}",
    " \\begin{itemize}[leftmargin=0.15in, label={}]",
    `    \\small{\\item{${escapeForCommand(document.summary)}}}`,
    " \\end{itemize}",
    "",
  ].join("\n");
}

function renderEntrySection(args: {
  title: string;
  entries: LatexResumeEntry[];
  kind: "subheading" | "project" | "education";
  isCharter?: boolean;
}): string {
  if (args.entries.length === 0) return "";
  if (args.isCharter) {
    const body = args.entries
      .map((entry) => {
        if (args.kind === "education")
          return renderCharterEducationEntry(entry);
        if (args.kind === "project") return renderCharterProjectEntry(entry);
        return renderCharterSubheadingEntry(entry);
      })
      .join("\n\n");
    return [`\\section*{${args.title}}`, body, "\\vspace{-6.5pt}", ""].join(
      "\n",
    );
  }
  const body = args.entries
    .map((entry) =>
      args.kind === "project"
        ? renderProjectEntry(entry)
        : renderSubheadingEntry(entry),
    )
    .join("\n\n");
  return [
    `\\section{${args.title}}`,
    "  \\resumeSubHeadingListStart",
    body,
    "  \\resumeSubHeadingListEnd",
    "",
  ].join("\n");
}

function renderSkillsSection(
  document: LatexResumeDocument,
  isCharter = false,
): string {
  if (document.skillGroups.length === 0) return "";
  if (isCharter) {
    const items = document.skillGroups
      .map((group) => {
        const keywords = group.keywords
          .map((keyword) => escapeForCommand(keyword))
          .join(", ");
        return `\\textbf{${escapeForCommand(group.name)}:} ${keywords} \\\\`;
      })
      .join("\n");
    return ["\\section*{Skills}", items, "\\vspace{-6.5pt}", ""].join("\n");
  }
  const items = document.skillGroups
    .map((group) => {
      const keywords = group.keywords
        .map((keyword) => escapeForCommand(keyword))
        .join(", ");
      return `     \\textbf{${escapeForCommand(group.name)}}{: ${keywords}} \\\\`;
    })
    .join("\n");
  return [
    "\\section{Technical Skills}",
    " \\begin{itemize}[leftmargin=0.15in, label={}]",
    "    \\small{\\item{",
    items,
    "    }}",
    " \\end{itemize}",
    "",
  ].join("\n");
}

async function loadTemplate(
  templateId: LatexTemplateId,
  customContent?: string,
): Promise<string> {
  if (templateId === "custom") {
    if (customContent?.trim()) return customContent;
    const dbValue = await getSetting("customLatexTemplate");
    if (dbValue?.trim()) return dbValue;
    return await readFile(resolveTemplatePath("charter"), "utf8");
  }
  return await readFile(resolveTemplatePath(templateId), "utf8");
}

export function buildLatexDocument(
  document: LatexResumeDocument,
  template: string,
  templateId?: LatexTemplateId,
): string {
  const isCharter =
    templateId === "charter" || !template.includes("\\resumeSubheading");
  const headlineBlock = document.headline
    ? `    \\small ${escapeForCommand(document.headline)} \\\\ \\vspace{1pt}\n`
    : "";
  const contactBlock =
    document.contactItems.length > 0
      ? `    \\small ${renderContactItems(document.contactItems)}\n`
      : "";

  const skillsSection = renderSkillsSection(document, isCharter);
  const experienceSection = renderEntrySection({
    title: "Experience",
    entries: document.experience,
    kind: "subheading",
    isCharter,
  });
  const educationSection = renderEntrySection({
    title: "Education",
    entries: document.education,
    kind: "education",
    isCharter,
  });
  const projectsSection = renderEntrySection({
    title: "Projects",
    entries: document.projects,
    kind: "project",
    isCharter,
  });
  const summarySection = renderSummarySection(document, isCharter);

  const body = isCharter
    ? [
        skillsSection,
        experienceSection,
        educationSection,
        projectsSection,
        summarySection,
      ]
        .filter(Boolean)
        .join("\n")
    : [
        summarySection,
        experienceSection,
        educationSection,
        projectsSection,
        skillsSection,
      ]
        .filter(Boolean)
        .join("\n");

  return template
    .replace("__NAME__", escapeForCommand(document.name))
    .replace("__HEADLINE_BLOCK__", headlineBlock)
    .replace("__CONTACT_BLOCK__", contactBlock)
    .replace("__SKILLS__", skillsSection)
    .replace("__EXPERIENCE__", experienceSection)
    .replace("__EDUCATION__", educationSection)
    .replace("__PROJECTS__", projectsSection)
    .replace("__SUMMARY__", summarySection)
    .replace("__BODY__", body);
}

function truncateOutput(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 1200) return trimmed;
  return `${trimmed.slice(0, 1200)}…(truncated ${trimmed.length - 1200} chars)`;
}

async function runTectonic(args: {
  cwd: string;
  texPath: string;
  jobId: string;
}): Promise<void> {
  const binary = process.env.TECTONIC_BIN?.trim() || "tectonic";

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["--outdir", args.cwd, args.texPath], {
      cwd: args.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new Error(
          `Tectonic timed out after ${TECTONIC_TIMEOUT_MS / 1000}s while rendering resume PDF.`,
        ),
      );
    }, TECTONIC_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            `Tectonic binary not found. Install tectonic or set TECTONIC_BIN to the executable path.`,
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          `Tectonic failed with exit code ${code ?? "unknown"}. ${truncateOutput(stderr || stdout)}`,
        ),
      );
    });
  }).catch((error) => {
    logger.warn("LaTeX resume compile failed", {
      jobId: args.jobId,
      error,
      compiler: binary,
    });
    throw error;
  });
}

export const latexResumeRenderer: ResumeRenderer = {
  async render({
    document,
    outputPath,
    jobId,
    templateId = "charter",
    customTemplateContent,
  }) {
    const tempDir = await mkdtemp(
      join(tmpdir(), `job-ops-resume-render-${jobId}-`),
    );
    const texPath = join(tempDir, "resume.tex");
    const compiledPdfPath = join(tempDir, OUTPUT_FILENAME);

    try {
      const template = await loadTemplate(templateId, customTemplateContent);
      const latex = buildLatexDocument(document, template, templateId);

      await writeFile(texPath, latex, "utf8");
      await runTectonic({ cwd: tempDir, texPath, jobId });
      await copyFile(compiledPdfPath, outputPath);

      logger.info("Rendered LaTeX resume PDF", {
        jobId,
        outputPath,
        templateId,
      });
    } catch (error) {
      logger.error("Failed to render LaTeX resume PDF", {
        jobId,
        outputPath,
        templateId,
        error,
        document: sanitizeUnknown({
          name: document.name,
          headline: document.headline,
          experienceCount: document.experience.length,
          educationCount: document.education.length,
          projectCount: document.projects.length,
          skillGroupCount: document.skillGroups.length,
        }),
      });
      throw error;
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(
        (cleanupError) => {
          logger.warn("Failed to cleanup temporary LaTeX render directory", {
            jobId,
            tempDir,
            error: cleanupError,
          });
        },
      );
    }
  },
};

export async function renderLatexPdf(args: {
  document: LatexResumeDocument;
  outputPath: string;
  jobId: string;
  templateId?: LatexTemplateId;
  customTemplateContent?: string;
}): Promise<void> {
  await latexResumeRenderer.render(args);
}

export function getLatexTemplatePath(
  templateId: LatexTemplateId = "charter",
): string {
  return resolveTemplatePath(templateId);
}

export function getTectonicBinary(): string {
  return process.env.TECTONIC_BIN?.trim() || "tectonic";
}

export async function readLatexTemplate(
  templateId: LatexTemplateId = "charter",
): Promise<string> {
  return await loadTemplate(templateId);
}
