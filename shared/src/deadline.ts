/**
 * Deadline lifecycle helpers: parse deadlines from posting text, compute
 * urgency for UI sort/tie-breaks, and drive the expiry sweep that auto-marks
 * past-deadline jobs expired (reversible on re-discovery).
 */

const ISO_DATE_RE = /\b(\d{4})-(\d{2})-(\d{2})\b/;

const NON_ISO_DATE_RES: RegExp[] = [
  // 15.03.2026 / 15/03/2026
  /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/g,
  // 15 March 2026 / Mar 15, 2026
  /\b(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4}))\b/gi,
];

const DEADLINE_KEYWORDS =
  /(deadline|closing date|applications? close|expires?)\b/i;

const MONTH_MAP: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

function pad2(n: string | number): string {
  return String(n).padStart(2, "0");
}

/**
 * Extract the first plausibly deadline-anchored date from free text. Returns
 * an ISO YYYY-MM-DD string, or null when no convincing deadline is stated.
 * Defensive: never infers a deadline from a bare "date" field, only from
 * lines whose text mentions deadline/closing/phrases, plus ISO dates in
 * those lines. A bare "apply soon" or the posting date itself does not
 * count.
 */
export function extractDeadlineFromText(text: string): string | null {
  if (!text) return null;
  // Candidate lines: any line within 2 lines of a deadline keyword.
  const lines = text.split(/\r?\n/);
  const deadlineLines = new Set<number>();
  const keywordLines = new Set<number>();
  for (let i = 0; i < lines.length; i++) {
    if (DEADLINE_KEYWORDS.test(lines[i])) {
      keywordLines.add(i);
      deadlineLines.add(i);
      if (i + 1 < lines.length) deadlineLines.add(i + 1);
      if (i + 2 < lines.length) deadlineLines.add(i + 2);
      if (i - 1 >= 0) deadlineLines.add(i - 1);
    }
  }
  const keywordText =
    keywordLines.size > 0
      ? Array.from(keywordLines)
          .sort((a, b) => a - b)
          .map((i) => lines[i])
          .join("\n")
      : "";
  const candidateText =
    deadlineLines.size > 0
      ? Array.from(deadlineLines)
          .sort((a, b) => a - b)
          .map((i) => lines[i])
          .join("\n")
      : "";
  if (candidateText.length === 0) return null;

  // Prefer dates on the keyword line itself before nearby lines.
  for (const haystack of [keywordText, candidateText]) {
    const iso = haystack.match(ISO_DATE_RE);
    if (iso) {
      const y = Number(iso[1]);
      const m = Number(iso[2]);
      const d = Number(iso[3]);
      if (m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2020 && y <= 2035) {
        return `${iso[1]}-${pad2(iso[2])}-${pad2(iso[3])}`;
      }
    }
    for (const re of NON_ISO_DATE_RES) {
      re.lastIndex = 0;
      const m = re.exec(haystack);
      if (!m) continue;
      // m groups vary by pattern; resolve to an ISO string when possible.
      let iso2: string | null = null;
      if (
        m[0].includes(".") ||
        (m[0].includes("/") && /^\d{1,2}[./]/.test(m[0]))
      ) {
        const day = Number(m[1]);
        const mon = Number(m[2]);
        const year = Number(m[3]);
        if (day >= 1 && day <= 31 && mon >= 1 && mon <= 12) {
          iso2 = `${year}-${pad2(mon)}-${pad2(day)}`;
        }
      } else if (m[1]) {
        // Mon Day, Year  (e.g. Mar 15, 2026)
        const mon = MONTH_MAP[m[1].toLowerCase().slice(0, 3)];
        const day = Number(m[2]);
        const year = Number(m[3]);
        if (mon) iso2 = `${year}-${mon}-${pad2(day)}`;
      } else if (m[4]) {
        // Day Mon Year
        const day = Number(m[4]);
        const mon = MONTH_MAP[m[5].toLowerCase().slice(0, 3)];
        const year = Number(m[6]);
        if (mon) iso2 = `${year}-${mon}-${pad2(day)}`;
      }
      if (iso2) {
        const [yy] = iso2.split("-").map(Number);
        if (yy >= 2020 && yy <= 2035) return iso2;
      }
    }
  }
  return null;
}

export function parseIsoDateAsUtcMidnight(iso: string): number | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

export function daysUntilDeadline(deadline: string | null): number | null {
  if (!deadline) return null;
  const ms = parseIsoDateAsUtcMidnight(deadline);
  if (ms === null) return null;
  const todayUtc = Date.UTC(
    new Date().getUTCFullYear(),
    new Date().getUTCMonth(),
    new Date().getUTCDate(),
  );
  return Math.floor((ms - todayUtc) / 86_400_000);
}

export function isPastDeadline(deadline: string | null): boolean {
  const d = daysUntilDeadline(deadline);
  return d !== null && d < 0;
}

export function isUrgentDeadline(
  deadline: string | null,
  withinDays = 7,
): boolean {
  const d = daysUntilDeadline(deadline);
  return d !== null && d >= 0 && d <= withinDays;
}
