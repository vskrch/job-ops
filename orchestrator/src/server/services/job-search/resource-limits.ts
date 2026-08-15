/**
 * Resource classification and operational limits for job search execution
 * (ADR-002). Providers with browser/subprocess/shared-storage workloads are
 * deliberately conservative: unknown manifests default to one concurrent run.
 */

import * as settingsRepo from "@server/repositories/settings";
import type { SearchResourceGroup } from "@shared/types";

export const SOURCE_PLAN_VERSION = "1";

export interface ExtractorCapability {
  resourceGroup: SearchResourceGroup;
  maxConcurrency: number;
  usesSharedStorage: boolean;
  timeoutMs: number;
}

/** Per-manifest capability map. Unknown manifests use the conservative default. */
const MANIFEST_CAPABILITIES: Record<string, ExtractorCapability> = {
  // Browser crawlers with shared dataset paths.
  gradcracker: {
    resourceGroup: "browser",
    maxConcurrency: 1,
    usesSharedStorage: true,
    timeoutMs: 300_000,
  },
  hiringcafe: {
    resourceGroup: "browser",
    maxConcurrency: 1,
    usesSharedStorage: true,
    timeoutMs: 300_000,
  },
  ukvisajobs: {
    resourceGroup: "auth-single-flight",
    maxConcurrency: 1,
    usesSharedStorage: true,
    timeoutMs: 300_000,
  },
  // Subprocess runners with shared dataset paths.
  jobspy: {
    resourceGroup: "subprocess-heavy",
    maxConcurrency: 1,
    usesSharedStorage: true,
    timeoutMs: 300_000,
  },
  adzuna: {
    resourceGroup: "subprocess-heavy",
    maxConcurrency: 1,
    usesSharedStorage: true,
    timeoutMs: 300_000,
  },
  // Multi-source HTTP providers.
  ats: {
    resourceGroup: "api-light",
    maxConcurrency: 3,
    usesSharedStorage: false,
    timeoutMs: 120_000,
  },
  jobboards: {
    resourceGroup: "api-light",
    maxConcurrency: 3,
    usesSharedStorage: false,
    timeoutMs: 180_000,
  },
  // Rate-limited API.
  usajobs: {
    resourceGroup: "api-rate-limited",
    maxConcurrency: 2,
    usesSharedStorage: false,
    timeoutMs: 60_000,
  },
  // Meta-search adapters (SerpAPI, SearXNG, etc.).
  "meta-search": {
    resourceGroup: "api-light",
    maxConcurrency: 2,
    usesSharedStorage: false,
    timeoutMs: 60_000,
  },
};

const DEFAULT_CAPABILITY: ExtractorCapability = {
  resourceGroup: "api-light",
  maxConcurrency: 1,
  usesSharedStorage: false,
  timeoutMs: 120_000,
};

export function getCapability(manifestId: string): ExtractorCapability {
  return MANIFEST_CAPABILITIES[manifestId] ?? DEFAULT_CAPABILITY;
}

/**
 * Environment (or settings) keys that gate a provider's availability.
 * A source is skipped when it requires credentials and none are present.
 */
const CREDENTIAL_KEYS_BY_SOURCE: Record<
  string,
  Array<{ env: string; setting?: string }>
> = {
  adzuna: [
    { env: "ADZUNA_APP_ID", setting: "adzunaAppId" },
    { env: "ADZUNA_APP_KEY", setting: "adzunaAppKey" },
  ],
  ukvisajobs: [
    { env: "UKVISAJOBS_EMAIL", setting: "ukvisajobsEmail" },
    { env: "UKVISAJOBS_PASSWORD", setting: "ukvisajobsPassword" },
  ],
  usajobs: [{ env: "USAJOBS_API_KEY" }],
};

export function credentialsAvailableForSource(
  source: string,
  settings: Partial<Record<string, string | undefined>>,
): boolean {
  const keys = CREDENTIAL_KEYS_BY_SOURCE[source];
  if (!keys || keys.length === 0) return true;
  return keys.some(({ env, setting }) => {
    if (process.env[env]?.trim()) return true;
    const settingValue = setting ? settings[setting] : undefined;
    return Boolean(settingValue?.trim());
  });
}

export interface SearchLimits {
  maxActiveSearches: number;
  sourceConcurrency: number;
  rankingConcurrency: number;
  maxCandidates: number;
  maxRankedCandidates: number;
  sourceTimeoutMs: number;
  rankingTimeoutMs: number;
  partialResultsEnabled: boolean;
  highConcurrencyEnabled: boolean;
  metaSearchEnabled: boolean;
  metaSearchTimeoutMs: number;
}

const DEFAULTS: SearchLimits = {
  maxActiveSearches: 4,
  sourceConcurrency: 4,
  rankingConcurrency: 2,
  maxCandidates: 2000,
  maxRankedCandidates: 300,
  sourceTimeoutMs: 180_000,
  rankingTimeoutMs: 30_000,
  partialResultsEnabled: false,
  highConcurrencyEnabled: false,
  metaSearchEnabled: true,
  metaSearchTimeoutMs: 60_000,
};

function readInt(
  settings: Partial<Record<string, string | undefined>>,
  key: string,
  fallback: number,
): number {
  const raw = settings[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readBool(
  settings: Partial<Record<string, string | undefined>>,
  key: string,
  fallback: boolean,
): boolean {
  const raw = settings[key];
  if (raw === undefined) return fallback;
  return raw === "1" || raw === "true";
}

/**
 * Resolve operational limits from settings. The high-concurrency flag gates
 * source concurrency above the safe default; provider-specific limits remain
 * code-defined rather than user-exposed.
 */
export async function resolveSearchLimits(): Promise<SearchLimits> {
  const settings = await settingsRepo.getAllSettings();
  const sourceConcurrency = Math.max(
    1,
    Math.min(
      6,
      readInt(
        settings,
        "jobSearchSourceConcurrency",
        DEFAULTS.sourceConcurrency,
      ),
    ),
  );
  const highConcurrencyEnabled = readBool(
    settings,
    "jobSearchHighConcurrencyEnabled",
    DEFAULTS.highConcurrencyEnabled,
  );

  return {
    maxActiveSearches: Math.max(
      1,
      Math.min(
        4,
        readInt(
          settings,
          "jobSearchMaxActiveSearches",
          DEFAULTS.maxActiveSearches,
        ),
      ),
    ),
    // The flag gates the configured value: without it, concurrency is capped
    // at the safe default of 3 even if a user raised the setting.
    sourceConcurrency: highConcurrencyEnabled
      ? sourceConcurrency
      : Math.min(sourceConcurrency, 3),
    rankingConcurrency: Math.max(
      1,
      Math.min(
        8,
        readInt(
          settings,
          "jobSearchRankingConcurrency",
          DEFAULTS.rankingConcurrency,
        ),
      ),
    ),
    maxCandidates: Math.max(
      10,
      Math.min(
        2000,
        readInt(settings, "jobSearchMaxCandidates", DEFAULTS.maxCandidates),
      ),
    ),
    maxRankedCandidates: Math.max(
      1,
      Math.min(
        500,
        readInt(
          settings,
          "jobSearchMaxRankedCandidates",
          DEFAULTS.maxRankedCandidates,
        ),
      ),
    ),
    sourceTimeoutMs: Math.max(
      1000,
      Math.min(
        300_000,
        readInt(settings, "jobSearchSourceTimeoutMs", DEFAULTS.sourceTimeoutMs),
      ),
    ),
    rankingTimeoutMs: Math.max(
      1000,
      Math.min(
        120_000,
        readInt(
          settings,
          "jobSearchRankingTimeoutMs",
          DEFAULTS.rankingTimeoutMs,
        ),
      ),
    ),
    partialResultsEnabled: readBool(
      settings,
      "jobSearchPartialResultsEnabled",
      DEFAULTS.partialResultsEnabled,
    ),
    highConcurrencyEnabled,
    metaSearchEnabled: readBool(
      settings,
      "metaSearchEnabled",
      DEFAULTS.metaSearchEnabled,
    ),
    metaSearchTimeoutMs: Math.max(
      1000,
      Math.min(
        120_000,
        readInt(settings, "metaSearchTimeoutMs", DEFAULTS.metaSearchTimeoutMs),
      ),
    ),
  };
}
