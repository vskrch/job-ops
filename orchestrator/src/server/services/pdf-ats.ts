/**
 * ATS parseability helpers for LaTeX/PDF resume output (A6).
 *
 * The checks verify what an ATS parser sees after `pdftotext -layout -enc UTF-8`:
 * literal contact, garbled markers, ASCII-hyphen date ranges, reading-order
 * hints, and keyword coverage. The poppler tooling is optional — callers
 * should degrade gracefully when unavailable.
 *
 * Implementation here is pure (operates on extracted text). The caller is
 * responsible for producing the text layer string.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { sanitizeUntrustedText } from "@shared/untrusted-content";

const execFileAsync = promisify(execFile);

let probeCache: boolean | null = null;

export async function isPdfTextToolsAvailable(): Promise<boolean> {
  if (probeCache !== null) return probeCache;
  try {
    await execFileAsync("pdftotext", ["-v"]);
    probeCache = true;
  } catch {
    probeCache = false;
  }
  return probeCache;
}

export function hasGarbledMarkers(text: string): boolean {
  return /\(cid:\d+\)|�/.test(text);
}

export function hasLiteralContact(
  text: string,
  contact: { email?: string | null; phone?: string | null },
): { emailPresent: boolean; phonePresent: boolean } {
  const lower = text.toLowerCase();
  const cleanEmail = contact.email?.toLowerCase().trim();
  const cleanPhone = contact.phone
    ? contact.phone.replace(/[^0-9+]+/g, "")
    : null;
  const digitsFromText = text.replace(/[^0-9+]/g, "").slice(0, 60);
  return {
    emailPresent: cleanEmail ? lower.includes(cleanEmail) : false,
    phonePresent: cleanPhone
      ? digitsFromText.includes(cleanPhone.slice(-7))
      : false,
  };
}

export function hasAsciiHyphenDateRange(text: string): boolean {
  // Valid: "2016-2024" or "Mar 2016 - Jul 2016" with ASCII hyphen; not an en-dash ligature --.
  // LaTeX \cventry{2016--2024} ligatures -- into U+2013. Detect the broken form explicitly.
  if (/\u2013/.test(text)) return false;
  return /\b\d{4}\s*-\s*\d{4}\b|\b[A-Za-z]{3}\s+\d{4}\s*-\s*[A-Za-z]{3}\s+\d{4}\b/.test(
    text,
  );
}

export type KeywordCoverageStatus =
  | "covered"
  | "synonym-only"
  | "missing (have it)"
  | "missing (gap)";

export interface KeywordCoverageRow {
  keyword: string;
  priority: "required" | "preferred";
  status: KeywordCoverageStatus;
  note?: string;
}

export function checkKeywordCoverage(
  extractedText: string,
  keywords: Array<{
    term: string;
    priority: "required" | "preferred";
    profileHasIt: boolean;
  }>,
): KeywordCoverageRow[] {
  const lowerText = extractedText.toLowerCase();
  const sanitized = (t: string) => sanitizeUntrustedText(t).toLowerCase();
  return keywords.map((k) => {
    const termLower = sanitized(k.term);
    const inText = termLower.length > 0 && lowerText.includes(termLower);
    if (inText)
      return {
        keyword: k.term,
        priority: k.priority,
        status: "covered" as const,
        note: "appears verbatim in text layer",
      };
    if (k.profileHasIt)
      return {
        keyword: k.term,
        priority: k.priority,
        status: "missing (have it)" as const,
        note: "profile supports this — add to an experience bullet, then re-run verification",
      };
    return {
      keyword: k.term,
      priority: k.priority,
      status: "missing (gap)" as const,
      note: "genuine gap — acknowledge in the cover letter, never stuff",
    };
  });
}

export async function extractTextLayerFromPdf(
  pdfPath: string,
): Promise<string | null> {
  if (!(await isPdfTextToolsAvailable())) return null;
  try {
    const { stdout } = await execFileAsync("pdftotext", [
      "-layout",
      "-enc",
      "UTF-8",
      pdfPath,
      "-",
    ]);
    return stdout ?? null;
  } catch {
    return null;
  }
}
