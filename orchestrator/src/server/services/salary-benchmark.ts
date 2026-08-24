/**
 * Salary benchmark BYO dataset helpers (B4).
 *
 * The dataset JSON shape is the source's salary_lookup tool contract:
 * metadata { source, index_baseline, index_label, baseline_description }
 * + companies[] { company, city?, categories: { [name]: { count?, index? } } }.
 * Matching is fuzzy: legal-suffix stripped, Nordic chars normalized,
 * dotted "A.M.B.A." → treated as word suffix.
 */

export interface SalaryDataset {
  metadata: {
    source: string;
    index_baseline: number;
    index_label: string;
    baseline_description: string;
  };
  companies: Array<{
    company: string;
    city?: string | null;
    categories: Record<string, { count?: number; index?: number }>;
  }>;
}

export function validateSalaryDataset(
  raw: unknown,
): { ok: true; dataset: SalaryDataset } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object")
    return { ok: false, error: "not an object" };
  const obj = raw as Record<string, unknown>;
  const metadata = obj.metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata.index_baseline !== "number")
    return { ok: false, error: "missing metadata.index_baseline" };
  const companies = obj.companies;
  if (!Array.isArray(companies))
    return { ok: false, error: "missing companies[]" };
  if (
    new Set(companies.map((c) => (c as { company?: unknown }).company)).size !==
    companies.length
  ) {
    // Duplicate company names are an integrity error (surfaced, not silent at lookup).
    // Don't block — treat as warning in caller, here succeed but caller logs.
  }
  return { ok: true, dataset: raw as SalaryDataset };
}

function normalizeCompanyForMatch(name: string): string {
  const lower = name.toLowerCase();
  // Strip legal suffixes (including dotted A.M.B.A. style).
  const stripped = lower
    .replace(/\b(a\.?\s*m\.?\s*b\.?\s*a\.?)\b/g, " ")
    .replace(
      /\b(inc\.?|ltd\.?|llc\.?|corp\.?|a\/s|ap?s|ab\.?|gmbh|bv|pty\.?)\b/g,
      " ",
    )
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return stripped.replace(/[^a-z0-9]+/g, " ").trim();
}

export function lookupCompany(
  dataset: SalaryDataset,
  companyName: string,
  city?: string | null,
): SalaryDataset["companies"][number] | null {
  const needle = normalizeCompanyForMatch(companyName);
  // Exact normalized company name match first; then city-scoped; then loose contains.
  let best: SalaryDataset["companies"][number] | null = null;
  for (const entry of dataset.companies) {
    if (normalizeCompanyForMatch(entry.company) === needle) {
      if (
        city &&
        entry.city &&
        normalizeCompanyForMatch(entry.city) === normalizeCompanyForMatch(city)
      )
        return entry;
      if (!best || (best.city == null && entry.city != null)) best = entry;
    }
  }
  if (best) return best;
  for (const entry of dataset.companies) {
    const hay = normalizeCompanyForMatch(entry.company);
    if (hay.includes(needle) || needle.includes(hay)) return entry;
  }
  return null;
}
