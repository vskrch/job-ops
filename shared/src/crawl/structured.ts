/**
 * Structured-data (JSON-LD) extraction for job pages.
 *
 * Most job boards embed schema.org `JobPosting` JSON-LD in their HTML.
 * Parsing it gives exact title/employer/location/salary/description fields
 * with zero regex guesswork and zero LLM cost. Every function here is
 * defensive: malformed JSON, wrong shapes, and missing fields are skipped,
 * never thrown.
 */

export interface JsonLdJobPosting {
  title?: string;
  employer?: string;
  url?: string;
  location?: string;
  salary?: string;
  datePosted?: string;
  employmentType?: string;
  description?: string;
}

const LD_JSON_SCRIPT_RE =
  /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
const MAX_SCRIPT_CHARS = 512_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isJobPosting(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  return (
    type === "JobPosting" ||
    (Array.isArray(type) && type.includes("JobPosting"))
  );
}

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  const record = asRecord(value);
  return record ? firstString(record.name) : undefined;
}

function mapLocation(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    const parts = value
      .map(mapLocation)
      .filter((part): part is string => Boolean(part));
    return parts.length > 0 ? parts.join(", ") : undefined;
  }
  if (typeof value === "string") return value.trim() || undefined;
  const record = asRecord(value);
  if (!record) return undefined;
  if (record.address) return mapLocation(record.address);
  const parts = [
    firstString(record.addressLocality),
    firstString(record.addressRegion),
    firstString(record.addressCountry),
  ].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function mapSalary(value: unknown): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  let raw = record.value;
  let period = firstString(record.unitText);
  const rawRecord = asRecord(raw);
  if (rawRecord) {
    period ??= firstString(rawRecord.unitText);
    raw = rawRecord.value;
  }
  const base =
    typeof raw === "number" ? String(raw) : (firstString(raw) ?? undefined);
  if (!base) return undefined;
  const parts = [base, firstString(record.currency)].filter(
    (part): part is string => Boolean(part),
  );
  return parts.length > 0
    ? parts.join(" ") + (period ? ` per ${period}` : "")
    : undefined;
}

function mapPosting(record: Record<string, unknown>): JsonLdJobPosting {
  const organization = asRecord(record.hiringOrganization);
  const employmentType = record.employmentType;
  return {
    title: firstString(record.title),
    employer: organization ? firstString(organization.name) : undefined,
    url: firstString(record.url) ?? firstString(record.sameAs),
    location: mapLocation(record.jobLocation),
    salary: mapSalary(record.baseSalary),
    datePosted: firstString(record.datePosted),
    employmentType: Array.isArray(employmentType)
      ? employmentType.map(String).join(", ") || undefined
      : firstString(employmentType),
    description: firstString(record.description),
  };
}

function collectPostings(node: unknown, out: JsonLdJobPosting[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectPostings(item, out);
    return;
  }
  const record = asRecord(node);
  if (!record) return;
  if (isJobPosting(record)) {
    out.push(mapPosting(record));
    return;
  }
  for (const key of ["@graph", "itemListElement", "mainEntity", "hasPart"]) {
    if (record[key]) collectPostings(record[key], out);
  }
}

/**
 * Extract all JobPosting records embedded in an HTML document. Never throws.
 */
export function extractJsonLdJobPostings(html: string): JsonLdJobPosting[] {
  const out: JsonLdJobPosting[] = [];
  for (const match of html.matchAll(LD_JSON_SCRIPT_RE)) {
    const raw = match[1];
    if (!raw || raw.length > MAX_SCRIPT_CHARS) continue;
    try {
      collectPostings(JSON.parse(raw), out);
    } catch {
      // Malformed JSON-LD block: skip it, keep the rest.
    }
  }
  return out;
}

/** True when a fetched body looks like raw HTML (vs Jina markdown/text). */
export function isHtmlText(text: string, contentType: string): boolean {
  if (contentType.includes("html")) return true;
  return text.trimStart().startsWith("<");
}
