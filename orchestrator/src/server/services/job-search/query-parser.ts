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

  const rawCountry = asString(locationRaw?.country ?? null);
  const country = rawCountry
    ? (SUPPORTED_COUNTRY_KEYS.find(
        (key) => key === normalizeCountryKey(rawCountry),
      ) ?? normalizeCountryKey(rawCountry))
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
 * Comprehensive offline rule-based NLP parser for natural language job search queries.
 * Extracts roles, seniority, skills, country, cities, work mode, experience, salary,
 * freshness, and exclude terms without requiring an external LLM API key.
 */
export function extractRuleBasedSearchSpec(query: string): ParsedSearchSpec {
  const text = query.trim();
  if (!text) {
    return {
      ...EMPTY_SPEC,
      location: { ...EMPTY_SPEC.location },
      experience: { ...EMPTY_SPEC.experience },
      salary: { ...EMPTY_SPEC.salary },
      postedWithin: { ...EMPTY_SPEC.postedWithin },
    };
  }

  const explicitConstraints: string[] = [];
  const inferredPreferences: string[] = [];

  // 1. Work Mode
  let workMode: ParsedSearchSpec["workMode"] = "any";
  if (/\b(?:remote\s+or\s+hybrid|hybrid\s+or\s+remote)\b/i.test(text)) {
    workMode = "hybrid";
    explicitConstraints.push("workMode: hybrid or remote");
  } else if (
    /\b(?:remote|work from home|wfh|telecommute|anywhere)\b/i.test(text)
  ) {
    workMode = "remote";
    explicitConstraints.push("workMode: remote");
  } else if (/\bhybrid\b/i.test(text)) {
    workMode = "hybrid";
    explicitConstraints.push("workMode: hybrid");
  } else if (
    /\b(?:onsite|on-site|in-office|in person|in-person)\b/i.test(text)
  ) {
    workMode = "onsite";
    explicitConstraints.push("workMode: onsite");
  }

  // 2. Freshness / Posted Within
  let postedWithin: ParsedSearchSpec["postedWithin"] = {
    value: null,
    unit: null,
  };
  const h24Match =
    /\b(?:today|last\s+24\s*h(?:ours?)?|past\s+24\s*h(?:ours?)?|within\s+24\s*h(?:ours?)?)\b/i.exec(
      text,
    );
  const hoursMatch = /\b(?:last|past|within)\s+(\d+)\s*h(?:ours?)?\b/i.exec(
    text,
  );
  const daysMatch = /\b(?:last|past|within)\s+(\d+)\s*days?\b/i.exec(text);
  const weeksMatch = /\b(?:last|past|within)\s+(\d+)\s*weeks?\b/i.exec(text);
  const weekMatch = /\b(?:this\s+week|last\s+week|past\s+week)\b/i.exec(text);

  if (h24Match) {
    postedWithin = { value: 24, unit: "hours" };
    explicitConstraints.push("postedWithin: 24 hours");
  } else if (hoursMatch) {
    postedWithin = { value: Number.parseInt(hoursMatch[1], 10), unit: "hours" };
    explicitConstraints.push(`postedWithin: ${hoursMatch[1]} hours`);
  } else if (daysMatch) {
    postedWithin = { value: Number.parseInt(daysMatch[1], 10), unit: "days" };
    explicitConstraints.push(`postedWithin: ${daysMatch[1]} days`);
  } else if (weeksMatch) {
    postedWithin = { value: Number.parseInt(weeksMatch[1], 10), unit: "weeks" };
    explicitConstraints.push(`postedWithin: ${weeksMatch[1]} weeks`);
  } else if (weekMatch) {
    postedWithin = { value: 7, unit: "days" };
    explicitConstraints.push("postedWithin: 7 days");
  }

  // 3. Experience
  let experience: ParsedSearchSpec["experience"] = {
    minYears: null,
    maxYears: null,
  };
  const rangeExpMatch =
    /\b(\d+)\s*(?:-|to)\s*(\d+)\s*(?:years?|yrs?)(?:\s*(?:of\s*)?exp(?:erience)?)?\b/i.exec(
      text,
    );
  const plusExpMatch =
    /\b(\d+)\+\s*(?:years?|yrs?)(?:\s*(?:of\s*)?exp(?:erience)?)?\b/i.exec(
      text,
    );
  const singleExpMatch =
    /\b(?:at least|minimum|min)\s*(\d+)\s*(?:years?|yrs?)(?:\s*(?:of\s*)?exp(?:erience)?)?\b/i.exec(
      text,
    );

  if (rangeExpMatch) {
    experience = {
      minYears: Number.parseInt(rangeExpMatch[1], 10),
      maxYears: Number.parseInt(rangeExpMatch[2], 10),
    };
    explicitConstraints.push(
      `experience: ${rangeExpMatch[1]}-${rangeExpMatch[2]} years`,
    );
  } else if (plusExpMatch) {
    experience = {
      minYears: Number.parseInt(plusExpMatch[1], 10),
      maxYears: null,
    };
    explicitConstraints.push(`experience: ${plusExpMatch[1]}+ years`);
  } else if (singleExpMatch) {
    experience = {
      minYears: Number.parseInt(singleExpMatch[1], 10),
      maxYears: null,
    };
    explicitConstraints.push(`experience: ${singleExpMatch[1]}+ years`);
  }

  // 4. Salary
  let salary: ParsedSearchSpec["salary"] = {
    min: null,
    max: null,
    currency: null,
  };
  const salaryMatch =
    /\b(?:paying|salary|over|above|min|minimum)?\s*([$£€₹]|CAD|USD|GBP|EUR|AUD|INR)?\s*(\d{2,3})(?:k|000)?\s*(?:\+|plus)?\b/i.exec(
      text,
    );
  if (salaryMatch && Number.parseInt(salaryMatch[2], 10) >= 20) {
    const rawVal = Number.parseInt(salaryMatch[2], 10);
    const amount = rawVal < 1000 ? rawVal * 1000 : rawVal;
    let currency: string | null = null;
    const currSym = (salaryMatch[1] ?? "").toUpperCase();
    if (currSym === "$" || currSym === "USD") currency = "USD";
    else if (currSym === "CAD") currency = "CAD";
    else if (currSym === "£" || currSym === "GBP") currency = "GBP";
    else if (currSym === "€" || currSym === "EUR") currency = "EUR";
    else if (currSym === "AUD") currency = "AUD";
    else if (currSym === "₹" || currSym === "INR") currency = "INR";
    else if (/\bCAD\b/i.test(text)) currency = "CAD";
    else if (/\bUSD\b/i.test(text)) currency = "USD";
    else if (/\bGBP|£\b/i.test(text)) currency = "GBP";
    else if (/\bEUR|€\b/i.test(text)) currency = "EUR";

    salary = { min: amount, max: null, currency };
    explicitConstraints.push(
      `salary: ${amount}${currency ? ` ${currency}` : ""}`,
    );
  }

  // 5. Seniority
  let seniority: string | null = null;
  const seniorityMatch =
    /\b(senior|sr\.?|lead|staff|principal|director|head|vp|junior|jr\.?|entry[- ]level|intern(?:ship)?|graduate|mid[- ]level)\b/i.exec(
      text,
    );
  if (seniorityMatch) {
    const raw = seniorityMatch[1]
      .toLowerCase()
      .replace(".", "")
      .replace("-", " ");
    if (raw === "sr") seniority = "senior";
    else if (raw === "jr") seniority = "junior";
    else seniority = raw;
    explicitConstraints.push(`seniority: ${seniority}`);
  }

  // 6. Location: Country & Cities
  let country: string | null = null;
  const cities: string[] = [];

  const KNOWN_COUNTRIES: Array<{ regex: RegExp; key: string }> = [
    { regex: /\b(?:canada)\b/i, key: "canada" },
    {
      regex: /\b(?:united states|usa|u\.s\.a?\b|america)\b/i,
      key: "united states",
    },
    {
      regex:
        /\b(?:united kingdom|uk|u\.k\.|great britain|britain|england|scotland|wales)\b/i,
      key: "united kingdom",
    },
    { regex: /\b(?:germany|deutschland)\b/i, key: "germany" },
    { regex: /\b(?:france)\b/i, key: "france" },
    { regex: /\b(?:australia|aus)\b/i, key: "australia" },
    { regex: /\b(?:india|bharat)\b/i, key: "india" },
    { regex: /\b(?:ireland)\b/i, key: "ireland" },
    { regex: /\b(?:netherlands|holland)\b/i, key: "netherlands" },
    { regex: /\b(?:spain)\b/i, key: "spain" },
    { regex: /\b(?:singapore)\b/i, key: "singapore" },
    { regex: /\b(?:switzerland)\b/i, key: "switzerland" },
    { regex: /\b(?:sweden)\b/i, key: "sweden" },
    { regex: /\b(?:poland)\b/i, key: "poland" },
    { regex: /\b(?:worldwide|global)\b/i, key: "worldwide" },
  ];

  for (const c of KNOWN_COUNTRIES) {
    if (c.regex.test(text)) {
      country = c.key;
      explicitConstraints.push(`country: ${country}`);
      break;
    }
  }

  const KNOWN_CITIES: Array<{ regex: RegExp; name: string; country?: string }> =
    [
      { regex: /\btoronto\b/i, name: "Toronto", country: "canada" },
      { regex: /\bvancouver\b/i, name: "Vancouver", country: "canada" },
      { regex: /\bmontreal\b/i, name: "Montreal", country: "canada" },
      { regex: /\bottawa\b/i, name: "Ottawa", country: "canada" },
      { regex: /\bcalgary\b/i, name: "Calgary", country: "canada" },
      { regex: /\bwaterloo\b/i, name: "Waterloo", country: "canada" },
      { regex: /\blondon\b/i, name: "London", country: "united kingdom" },
      {
        regex: /\bmanchester\b/i,
        name: "Manchester",
        country: "united kingdom",
      },
      {
        regex: /\bbirmingham\b/i,
        name: "Birmingham",
        country: "united kingdom",
      },
      { regex: /\bedinburgh\b/i, name: "Edinburgh", country: "united kingdom" },
      {
        regex: /\bnew york(?: city)?|nyc\b/i,
        name: "New York",
        country: "united states",
      },
      {
        regex: /\bsan francisco|bay area|sf\b/i,
        name: "San Francisco",
        country: "united states",
      },
      { regex: /\bseattle\b/i, name: "Seattle", country: "united states" },
      { regex: /\baustin\b/i, name: "Austin", country: "united states" },
      { regex: /\bboston\b/i, name: "Boston", country: "united states" },
      { regex: /\bchicago\b/i, name: "Chicago", country: "united states" },
      {
        regex: /\blos angeles|la\b/i,
        name: "Los Angeles",
        country: "united states",
      },
      { regex: /\bberlin\b/i, name: "Berlin", country: "germany" },
      { regex: /\bmunich\b/i, name: "Munich", country: "germany" },
      { regex: /\bparis\b/i, name: "Paris", country: "france" },
      { regex: /\bamsterdam\b/i, name: "Amsterdam", country: "netherlands" },
      { regex: /\bdublin\b/i, name: "Dublin", country: "ireland" },
      { regex: /\bsydney\b/i, name: "Sydney", country: "australia" },
      { regex: /\bmelbourne\b/i, name: "Melbourne", country: "australia" },
      {
        regex: /\bbangalore|bengaluru\b/i,
        name: "Bangalore",
        country: "india",
      },
      { regex: /\bhyderabad\b/i, name: "Hyderabad", country: "india" },
      { regex: /\bmumbai\b/i, name: "Mumbai", country: "india" },
      { regex: /\bdelhi\b/i, name: "Delhi", country: "india" },
      { regex: /\bpune\b/i, name: "Pune", country: "india" },
    ];

  for (const city of KNOWN_CITIES) {
    if (city.regex.test(text)) {
      if (!cities.includes(city.name)) {
        cities.push(city.name);
        explicitConstraints.push(`city: ${city.name}`);
      }
      if (!country && city.country) {
        country = city.country;
        inferredPreferences.push(`country inferred from city: ${country}`);
      }
    }
  }

  // 7. Skills & Technologies
  const KNOWN_SKILLS = [
    "react",
    "typescript",
    "javascript",
    "python",
    "node",
    "nodejs",
    "node.js",
    "golang",
    "go",
    "rust",
    "java",
    "c++",
    "c#",
    "aws",
    "gcp",
    "azure",
    "docker",
    "kubernetes",
    "k8s",
    "graphql",
    "sql",
    "postgres",
    "postgresql",
    "mysql",
    "mongodb",
    "redis",
    "nextjs",
    "next.js",
    "vue",
    "angular",
    "django",
    "fastapi",
    "flask",
    "pytorch",
    "tensorflow",
    "machine learning",
    "ml",
    "ai",
    "llm",
    "spark",
    "airflow",
    "snowflake",
    "dbt",
    "kafka",
    "devops",
    "terraform",
    "tailwind",
    "ruby",
    "rails",
    "solidity",
    "web3",
    "linux",
    "html",
    "css",
  ];

  const skills: string[] = [];
  for (const skill of KNOWN_SKILLS) {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const skillRegex = new RegExp(`\\b${escaped}\\b`, "i");
    if (skillRegex.test(text)) {
      skills.push(skill);
      explicitConstraints.push(`skill: ${skill}`);
    }
  }

  // 8. Roles & Titles
  const KNOWN_ROLE_PATTERNS: Array<{ pattern: RegExp; role: string }> = [
    { pattern: /\bfull[- ]?stack\b/i, role: "full stack developer" },
    { pattern: /\bdata\s+engineer(?:ing)?\b/i, role: "data engineer" },
    {
      pattern:
        /\bmachine[- ]learning\s+engineer(?:ing)?|ml\s+engineer(?:ing)?\b/i,
      role: "machine learning engineer",
    },
    {
      pattern:
        /\bai\s+engineer(?:ing)?|artificial\s+intelligence\s+engineer\b/i,
      role: "ai engineer",
    },
    {
      pattern: /\bbackend\s+(?:engineer(?:ing)?|developer)\b/i,
      role: "backend engineer",
    },
    {
      pattern: /\bfrontend\s+(?:engineer(?:ing)?|developer)\b/i,
      role: "frontend engineer",
    },
    {
      pattern: /\bpython\s+(?:developer|engineer(?:ing)?)\b/i,
      role: "python developer",
    },
    {
      pattern: /\breact\s+(?:developer|engineer(?:ing)?)\b/i,
      role: "react developer",
    },
    {
      pattern: /\bjava\s+(?:developer|engineer(?:ing)?)\b/i,
      role: "java developer",
    },
    {
      pattern:
        /\bgolang\s+(?:developer|engineer(?:ing)?)|go\s+(?:developer|engineer(?:ing)?)\b/i,
      role: "golang developer",
    },
    {
      pattern: /\bnode(?:\.js)?\s+(?:developer|engineer(?:ing)?)\b/i,
      role: "node developer",
    },
    { pattern: /\bdevops\s+engineer(?:ing)?\b/i, role: "devops engineer" },
    {
      pattern: /\bsite\s+reliability\s+engineer(?:ing)?|\bsre\b/i,
      role: "site reliability engineer",
    },
    {
      pattern: /\bcloud\s+(?:engineer(?:ing)?|architect)\b/i,
      role: "cloud engineer",
    },
    { pattern: /\bplatform\s+engineer(?:ing)?\b/i, role: "platform engineer" },
    {
      pattern: /\binfrastructure\s+engineer(?:ing)?\b/i,
      role: "infrastructure engineer",
    },
    {
      pattern: /\bsecurity\s+engineer(?:ing)?|cybersecurity\b/i,
      role: "security engineer",
    },
    {
      pattern:
        /\bqa\s+engineer(?:ing)?|test\s+engineer(?:ing)?|automation\s+engineer\b/i,
      role: "qa engineer",
    },
    {
      pattern:
        /\bmobile\s+(?:developer|engineer)|ios\s+(?:developer|engineer)|android\s+(?:developer|engineer)\b/i,
      role: "mobile engineer",
    },
    { pattern: /\bdata\s+scientist\b/i, role: "data scientist" },
    { pattern: /\bdata\s+analyst\b/i, role: "data analyst" },
    {
      pattern: /\banalytics\s+engineer(?:ing)?\b/i,
      role: "analytics engineer",
    },
    { pattern: /\bproduct\s+manager\b/i, role: "product manager" },
    { pattern: /\bengineering\s+manager\b/i, role: "engineering manager" },
    { pattern: /\btech\s+lead\b/i, role: "tech lead" },
    {
      pattern: /\bsoftware\s+(?:engineer(?:ing)?|developer)\b/i,
      role: "software engineer",
    },
    {
      pattern: /\bui\s*\/\s*ux\s+designer|product\s+designer\b/i,
      role: "product designer",
    },
  ];

  const roles: string[] = [];
  for (const { pattern, role } of KNOWN_ROLE_PATTERNS) {
    if (pattern.test(text)) {
      roles.push(role);
      explicitConstraints.push(`role: ${role}`);
      break;
    }
  }

  // If no predefined role pattern matched, try single title nouns or clean subject
  if (roles.length === 0) {
    const genericRoleMatch =
      /\b(developer|engineer|programmer|architect|consultant|specialist|analyst|designer)\b/i.exec(
        text,
      );
    if (genericRoleMatch && skills.length > 0) {
      const combined = `${skills[0]} ${genericRoleMatch[1].toLowerCase()}`;
      roles.push(combined);
      explicitConstraints.push(`role: ${combined}`);
    } else {
      // Strip common filler and constraint words
      const cleanSubject = text
        .replace(
          /\b(?:find|looking for|search(?:ing)? for|jobs?|roles?|positions?|openings?)\b/gi,
          "",
        )
        .replace(
          /\b(?:in|across)\s+(?:canada|united states|usa|us|uk|united kingdom|germany|france|australia|india|toronto|vancouver|london|new york|berlin)\b/gi,
          "",
        )
        .replace(/\b(?:remote|hybrid|onsite|work from home|wfh)\b/gi, "")
        .replace(
          /\b(?:\d+[-+]\d*\s*(?:years?|yrs?)|last\s+\d+\s*(?:days?|hours?|weeks?)|today|this week)\b/gi,
          "",
        )
        .replace(
          /\b(?:paying|salary|over|above|min|minimum)?\s*[$£€₹]?\s*\d+(?:k|000)?\+?\s*(?:CAD|USD|GBP|EUR)?\b/gi,
          "",
        )
        .replace(/[,;]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

      if (cleanSubject.length > 2 && cleanSubject.length < 60) {
        roles.push(cleanSubject);
        explicitConstraints.push(`role: ${cleanSubject}`);
      } else if (skills.length > 0) {
        const skillRole = `${skills.slice(0, 2).join(" ")} developer`;
        roles.push(skillRole);
        inferredPreferences.push(`role inferred from skills: ${skillRole}`);
      } else {
        roles.push("software engineer");
        inferredPreferences.push("role default: software engineer");
      }
    }
  }

  // 9. Exclude Terms
  const excludeTerms: string[] = [];
  const excludeMatches = text.matchAll(
    /\b(?:no|not|exclude|without)\s+([a-zA-Z0-9_-]+)\b/gi,
  );
  for (const m of excludeMatches) {
    if (m[1]) {
      const term = m[1].toLowerCase();
      if (
        ![
          "remote",
          "hybrid",
          "onsite",
          "canada",
          "us",
          "uk",
          "years",
          "days",
        ].includes(term)
      ) {
        excludeTerms.push(term);
        explicitConstraints.push(`exclude: ${term}`);
      }
    }
  }

  const interpretation = `Searching for ${roles.join(", ")}${locationSummary(country, cities)}${workMode !== "any" ? ` (${workMode})` : ""}${postedWithin.value ? `, posted within ${postedWithin.value} ${postedWithin.unit}` : ""}.`;

  return {
    roles,
    skills,
    location: { country, cities },
    workMode,
    employmentType: null,
    experience,
    salary,
    postedWithin,
    excludeTerms,
    seniority,
    industry: null,
    interpretation,
    confidence: explicitConstraints.length >= 2 ? "high" : "medium",
    explicitConstraints,
    inferredPreferences,
  };
}

function locationSummary(country: string | null, cities: string[]): string {
  if (cities.length > 0 && country)
    return ` in ${cities.join(", ")} (${country})`;
  if (cities.length > 0) return ` in ${cities.join(", ")}`;
  if (country) return ` in ${country}`;
  return "";
}

/**
 * Parse a natural-language job search query into a structured spec.
 * Attempts LLM parsing with robust error boundary; gracefully falls back to the
 * high-accuracy offline rule-based NLP extractor when LLM is unconfigured, times out,
 * or encounters API issues.
 */
export async function parseSearchQuery(
  query: string,
): Promise<ParsedSearchSpec> {
  const trimmed = query.trim();
  if (!trimmed) {
    return {
      ...EMPTY_SPEC,
      location: { ...EMPTY_SPEC.location },
      experience: { ...EMPTY_SPEC.experience },
      salary: { ...EMPTY_SPEC.salary },
      postedWithin: { ...EMPTY_SPEC.postedWithin },
    };
  }

  // Always compute rule-based baseline spec first
  const ruleBasedSpec = extractRuleBasedSearchSpec(trimmed);

  try {
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
      maxRetries: 1,
      timeoutMs: 10_000,
    });

    if (!result.success) {
      logger.info("LLM query parsing fell back to rule-based spec", {
        error: result.error,
        queryLength: trimmed.length,
        model,
        provider,
      });
      return ruleBasedSpec;
    }

    if (!result.data) {
      return ruleBasedSpec;
    }

    const normalized = normalizeSpec(result.data);

    // If LLM returned empty roles but rule-based extractor found a role, enrich it
    if (normalized.roles.length === 0 && ruleBasedSpec.roles.length > 0) {
      normalized.roles = ruleBasedSpec.roles;
    }
    // If LLM missed country but rule-based extractor detected one, enrich it
    if (!normalized.location.country && ruleBasedSpec.location.country) {
      normalized.location.country = ruleBasedSpec.location.country;
    }
    // If LLM missed cities but rule-based extractor detected them, enrich them
    if (
      normalized.location.cities.length === 0 &&
      ruleBasedSpec.location.cities.length > 0
    ) {
      normalized.location.cities = ruleBasedSpec.location.cities;
    }
    // If LLM missed workMode, enrich it
    if (normalized.workMode === "any" && ruleBasedSpec.workMode !== "any") {
      normalized.workMode = ruleBasedSpec.workMode;
    }
    // If LLM missed postedWithin, enrich it
    if (!normalized.postedWithin.value && ruleBasedSpec.postedWithin.value) {
      normalized.postedWithin = ruleBasedSpec.postedWithin;
    }

    return normalized;
  } catch (error) {
    logger.info(
      "LLM query parsing unavailable or timed out; using rule-based spec",
      {
        error: error instanceof Error ? error.message : String(error),
        queryLength: trimmed.length,
      },
    );
    return ruleBasedSpec;
  }
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
