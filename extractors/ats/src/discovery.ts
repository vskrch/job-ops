import { normalizeCountryKey } from "@shared/location-support.js";
import type { CreateJobInput } from "@shared/types/jobs";

export const DEFAULT_GREENHOUSE_BOARDS = [
  "stripe",
  "cloudflare",
  "datadog",
  "coinbase",
  "retool",
  "supabase",
  "vercel",
  "figma",
  "postman",
  "airbnb",
  "hashicorp",
  "discord",
  "gitlab",
  "elastic",
] as const;

export const DEFAULT_ASHBY_ORGS = [
  "linear",
  "perplexity",
  "mistral",
  "ramp",
  "deel",
  "synthesia",
  "cursor",
  "anysphere",
  "dust",
  "tldraw",
  "resend",
] as const;

export const DEFAULT_LEVER_COMPANIES = [
  "affirm",
  "palantir",
  "mux",
  "sourcegraph",
  "outreach",
  "plaid",
] as const;

export function matchesAtsJobFilter(
  job: CreateJobInput,
  searchTerms?: string[],
  selectedCountry?: string,
): boolean {
  if (selectedCountry) {
    const normCountry = normalizeCountryKey(selectedCountry);
    const jobLoc = (job.location ?? "").toLowerCase();
    const isRemote =
      job.isRemote || jobLoc.includes("remote") || jobLoc.includes("anywhere");
    if (
      !isRemote &&
      !jobLoc.includes(normCountry) &&
      normalizeCountryKey(jobLoc) !== normCountry
    ) {
      return false;
    }
  }

  if (!searchTerms || searchTerms.length === 0) {
    return true;
  }

  const title = (job.title ?? "").toLowerCase();
  const desc = (job.jobDescription ?? "").toLowerCase();
  const dept = (job.disciplines ?? "").toLowerCase();

  return searchTerms.some((term) => {
    const t = term.toLowerCase().trim();
    if (!t) return false;
    return title.includes(t) || desc.includes(t) || dept.includes(t);
  });
}
