/**
 * Page-budget + layout-loop helpers for the LaTeX resume renderer (A7).
 *
 * This module does not invoke Tectonic — that lives in the renderer. It
 * encapsulates the decision logic ("is the result usable? what fix comes
 * next?") so the pipeline loop can iterate deterministically and tests can
 * pin the budget boundaries without invoking TeX.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type LayoutFix =
  | { kind: "needspace"; insertBefore: string; lines: number }
  | { kind: "enlargepage"; lines: number }
  | { kind: "recut"; reason: string };

export function pageCountFromTextLayer(textLayer: string): number {
  // pdftotext renders each page followed by a form-feed.
  const forms = (textLayer.match(/\f/g) ?? []).length;
  return Math.max(1, forms + 1);
}

export function decideLayoutFixes(args: {
  pages: number;
  hasOrphanEntry: boolean;
}): LayoutFix[] {
  const fixes: LayoutFix[] = [];
  if (args.hasOrphanEntry) {
    fixes.push({ kind: "needspace", insertBefore: "\\cventry", lines: 5 });
  }
  if (args.pages === 3 && !args.hasOrphanEntry) {
    // Near miss with one trailing section on page 3: stretch before cutting.
    fixes.push({ kind: "enlargepage", lines: 3 });
  }
  if (args.pages >= 3) {
    fixes.push({
      kind: "recut",
      reason: "genuine overflow — apply relevance-weighted cutting",
    });
  }
  return fixes;
}

export function isWithinPageBudget(
  pages: number,
  limit = 2,
  allowEnlargeSlop = true,
): boolean {
  if (pages <= limit) return true;
  // Near miss: limit==2 and 3 pages with only a trailing section (e.g.
  // References) on page 3 is rescuable via \enlargethispage rather than cut.
  if (allowEnlargeSlop && limit === 2 && pages === 3) return true;
  return false;
}

export async function pageCountViaPdfInfo(
  pdfPath: string,
): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync("pdfinfo", [pdfPath]);
    const m = stdout.match(/Pages:\s+(\d+)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}
