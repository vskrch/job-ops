/**
 * LLM-powered natural-language job search query parser.
 *
 * Converts a free-text search request into a structured ParsedSearchSpec
 * using the existing LlmService infrastructure. Follows the same pattern
 * as scorer.ts: structured JSON output, schema validation, graceful fallback.
 */

import { randomUUID } from "node:crypto";
import { logger } from "@infra/logger";
import {
  normalizeCountryKey,
  SUPPORTED_COUNTRY_KEYS,
} from "@shared/location-support.js";
import { getDefaultPromptTemplate } from "@shared/prompt-template-definitions.js";
import type { ParsedSearchSpec } from "@shared/types";
import type { JsonSchemaDefinition } from "../llm/types";
import { createLlmClient } from "../modelSelection";
import { renderPromptTemplate } from "../prompt-templates";
import { getEffectiveSettings } from "../settings";

const SEARCH_PARSE_SCHEMA: JsonSchemaDefinition = {
  name: "job_search_spec",
  schema: {
    type: "object",
    properties: {
      roles: {
        type: "array",
        items: { type: "string" },
        description: "Job titles or roles the user is searching for",
      },
      skills: {
        type: "array",
        items: { type: "string" },
        description: "Skills or technologies mentioned",
      },
      location: {
        type: "object",
        properties: {
          country: {
            type: ["string", "null"],
            description: "Country name or null if not specified",
          },
          cities: {
            type: "array",
            items: { type: "string" },
            description: "City or region names",
          },
        },
        required: ["country", "cities"],
        additionalProperties: false,
      },
      workMode: {
        type: "string",
        enum: ["remote", "hybrid", "onsite", "any"],
        description: "Work arrangement preference",
      },
      employmentType: {
        type: ["string", "null"],
        enum: ["full_time", "part_time", "contract", null],
        description: "Employment type or null",
      },
      experience: {
        type: "object",
        properties: {
          minYears: {
            type: ["integer", "null"],
            description: "Minimum years of experience",
          },
          maxYears: {
            type: ["integer", "null"],
            description: "Maximum years of experience",
          },
        },
        required: ["minYears", "maxYears"],
        additionalProperties: false,
      },
      salary: {
        type: "object",
        properties: {
          min: {
            type: ["number", "null"],
            description: "Minimum salary amount",
          },
          max: {
            type: ["number", "null"],
            description: "Maximum salary amount",
          },
          currency: {
            type: ["string", "null"],
            description: "Salary currency code (e.g. CAD, USD)",
          },
        },
        required: ["min", "max", "currency"],
        additionalProperties: false,
      },
      postedWithin: {
        type: "object",
        properties: {
          value: {
            type: ["integer", "null"],
            description: "Numeric window value",
          },
          unit: {
            type: ["string", "null"],
            enum: ["hours", "days", "weeks", null],
            description: "Time unit for the window",
          },
        },
        required: ["value", "unit"],
        additionalProperties: false,
      },
      excludeTerms: {
        type: "array",
        items: { type: "string" },
        description: "Terms to exclude from search",
      },
      seniority: {
        type: ["string", "null"],
        description: "Seniority level (e.g. senior, junior, lead)",
      },
      industry: {
        type: ["string", "null"],
        description: "Industry preference",
      },
      interpretation: {
        type: "string",
        description: "1-2 sentence explanation of how the query was understood",
      },
      confidence: {
        type: "string",
        enum: ["high", "medium", "low"],
        description: "Confidence in the parsing",
      },
      explicitConstraints: {
        type: "array",
        items: { type: "string" },
        description: "Constraints the user explicitly stated",
      },
      inferredPreferences: {
        type: "array",
        items: { type: "string" },
        description: "Preferences inferred but not explicitly stated",
      },
    },
    required: [
      "roles",
      "skills",
      "location",
      "workMode",
      "employmentType",
      "experience",
      "salary",
      "postedWithin",
      "excludeTerms",
      "seniority",
      "industry",
      "interpretation",
      "confidence",
      "explicitConstraints",
      "inferredPreferences",
    ],
    additionalProperties: false,
  },
};

const EMPTY_SPEC: ParsedSearchSpec = {
  roles: [],
  skills: [],
  location: { country: null, cities: [] },
  workMode: "any",
  employmentType: null,
  experience: { minYears: null, maxYears: null },
  salary: { min: null, max: null, currency: null },
  postedWithin: { value: null, unit: null },
  excludeTerms: [],
  seniority: null,
  industry: null,
  interpretation: "",
  confidence: "low",
  explicitConstraints: [],
  inferredPreferences: [],
};

function normalizeSpec(raw: Record<string, unknown>): ParsedSearchSpec {
  const asString = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v
          .filter(
            (x): x is string => typeof x === "string" && x.trim().length > 0,
          )
          .map((x) => x.trim())
      : [];
  const asNumber = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const locationRaw = raw.location as Record<string, unknown> | undefined;
  const experienceRaw = raw.experience as Record<string, unknown> | undefined;
  const salaryRaw = raw.salary as Record<string, unknown> | undefined;
  const postedWithinRaw = raw.postedWithin as
    | Record<string, unknown>
    | undefined;

  // Restrict parsed countries to the app-supported set (US, Canada, India).
  // Anything else is dropped so UK/other markets can never leak in.
  const rawCountry = asString(locationRaw?.country ?? null);
  const country = rawCountry
    ? (SUPPORTED_COUNTRY_KEYS.find(
        (key) => key === normalizeCountryKey(rawCountry),
      ) ?? null)
    : null;

  return {
    roles: asStringArray(raw.roles),
    skills: asStringArray(raw.skills),
    location: {
      country,
      cities: asStringArray(locationRaw?.cities),
    },
    workMode: (asString(raw.workMode) as ParsedSearchSpec["workMode"]) ?? "any",
    employmentType:
      (asString(raw.employmentType) as ParsedSearchSpec["employmentType"]) ??
      null,
    experience: {
      minYears: asNumber(experienceRaw?.minYears),
      maxYears: asNumber(experienceRaw?.maxYears),
    },
    salary: {
      min: asNumber(salaryRaw?.min),
      max: asNumber(salaryRaw?.max),
      currency: asString(salaryRaw?.currency),
    },
    postedWithin: {
      value: asNumber(postedWithinRaw?.value),
      unit:
        (asString(
          postedWithinRaw?.unit,
        ) as ParsedSearchSpec["postedWithin"]["unit"]) ?? null,
    },
    excludeTerms: asStringArray(raw.excludeTerms),
    seniority: asString(raw.seniority),
    industry: asString(raw.industry),
    interpretation: asString(raw.interpretation) ?? "",
    confidence:
      (asString(raw.confidence) as ParsedSearchSpec["confidence"]) ?? "low",
    explicitConstraints: asStringArray(raw.explicitConstraints),
    inferredPreferences: asStringArray(raw.inferredPreferences),
  };
}

/**
 * Version of the query parser. Bumped whenever parsing semantics change so
 * cached admission hashes and parse results are invalidated safely.
 */
export const JOB_SEARCH_PARSER_VERSION = "1";

/**
 * Compute the synchronous admission hash used before the query is parsed.
 *
 * Identical normalized queries with the same parser/source-plan versions
 * produce the same hash, so concurrent identical submissions deduplicate to
 * one active search. Fresh requests append a nonce so they always create a
 * distinct run.
 */
export function computeAdmissionHash(
  query: string,
  options?: { fresh?: boolean; sourcePlanVersion?: string },
): string {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, " ");
  const nonce = options?.fresh ? randomUUID() : "";
  return JSON.stringify([
    normalized,
    JOB_SEARCH_PARSER_VERSION,
    options?.sourcePlanVersion ?? "1",
    nonce,
  ]);
}

/**
 * Parse a natural-language job search query into a structured spec.
 * Falls back to a minimal spec (roles = [query]) on LLM failure.
 */
export async function parseSearchQuery(
  query: string,
): Promise<ParsedSearchSpec> {
  const trimmed = query.trim();
  if (!trimmed)
    return {
      ...EMPTY_SPEC,
      location: { ...EMPTY_SPEC.location },
      experience: { ...EMPTY_SPEC.experience },
      salary: { ...EMPTY_SPEC.salary },
      postedWithin: { ...EMPTY_SPEC.postedWithin },
    };

  const [{ llm, model, provider }, settings] = await Promise.all([
    createLlmClient("default"),
    getEffectiveSettings(),
  ]);

  const template =
    settings.jobSearchParsePromptTemplate?.value ||
    getDefaultPromptTemplate("jobSearchParsePromptTemplate");

  const prompt = renderPromptTemplate(template, { userQuery: trimmed });

  const result = await llm.callJson<Record<string, unknown>>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: SEARCH_PARSE_SCHEMA,
    maxRetries: 2,
  });

  if (!result.success) {
    logger.warn("Job search query parsing failed, using fallback", {
      error: result.error,
      queryLength: trimmed.length,
      model,
      provider,
    });
    return {
      ...EMPTY_SPEC,
      roles: [trimmed],
      interpretation: "Query parsing failed; using raw query as search term.",
      confidence: "low",
    };
  }

  return normalizeSpec(result.data);
}

/**
 * Compute the semantic hash of a parsed search spec (post-parse).
 *
 * Includes every search-affecting field plus parser and source-plan versions
 * so cache identity changes when the interpretation of a query changes.
 */
export function computeSearchHash(
  query: string,
  spec: ParsedSearchSpec | null,
  versions?: { parserVersion?: string; sourcePlanVersion?: string },
): string {
  const normalized = {
    q: query.trim().toLowerCase(),
    parserVersion: versions?.parserVersion ?? JOB_SEARCH_PARSER_VERSION,
    sourcePlanVersion: versions?.sourcePlanVersion ?? "1",
    roles: spec?.roles.map((r) => r.toLowerCase()).sort() ?? [],
    skills: spec?.skills.map((s) => s.toLowerCase()).sort() ?? [],
    country: spec?.location.country?.toLowerCase() ?? null,
    cities: spec?.location.cities.map((c) => c.toLowerCase()).sort() ?? [],
    workMode: spec?.workMode ?? "any",
    employmentType: spec?.employmentType ?? null,
    exp: spec
      ? `${spec.experience.minYears ?? ""}-${spec.experience.maxYears ?? ""}`
      : "",
    salary: spec
      ? `${spec.salary.min ?? ""}-${spec.salary.max ?? ""}-${(spec.salary.currency ?? "").toLowerCase()}`
      : "",
    posted: spec?.postedWithin.value
      ? `${spec.postedWithin.value}-${spec.postedWithin.unit}`
      : "",
    excludeTerms: spec?.excludeTerms.map((t) => t.toLowerCase()).sort() ?? [],
    seniority: spec?.seniority?.toLowerCase() ?? null,
    industry: spec?.industry?.toLowerCase() ?? null,
  };
  return JSON.stringify(normalized);
}
