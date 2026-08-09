/**
 * Manifest execution planning for job search (ADR-002).
 *
 * Builds the auditable plan of manifest tasks for a search. Sources are
 * grouped by manifest so each multi-source manifest is invoked exactly once
 * with its exact selected source group — never once per source ID.
 */

import { logger } from "@infra/logger";
import type { ExtractorRegistry } from "@server/extractors/registry";
import {
  isSourceAllowedForCountry,
  normalizeCountryKey,
} from "@shared/location-support.js";
import type {
  ExtractorSourceId,
  ParsedSearchSpec,
  SearchManifestTask,
  SearchSourcePlan,
} from "@shared/types";
import { SOURCE_PLAN_VERSION, credentialsAvailableForSource, getCapability } from "./resource-limits";

type SettingsLike = Partial<Record<string, string | undefined>>;

/**
 * Build the manifest execution plan for a parsed spec.
 *
 * Sources that are incompatible with the requested country or lack required
 * credentials are recorded as skipped rather than scheduled as failures.
 */
export async function buildSourcePlan(
  spec: ParsedSearchSpec,
  registry: ExtractorRegistry,
  settings: SettingsLike,
): Promise<SearchSourcePlan> {
  const country = spec.location.country
    ? normalizeCountryKey(spec.location.country)
    : null;

  const skippedSources: Array<{ source: string; reason: string }> = [];
  const groupedByManifest = new Map<string, ExtractorSourceId[]>();

  for (const [source, manifest] of registry.manifestBySource) {
    if (country && !isSourceAllowedForCountry(source, country)) {
      skippedSources.push({ source, reason: "country" });
      continue;
    }

    if (!credentialsAvailableForSource(source, settings)) {
      skippedSources.push({ source, reason: "credentials" });
      continue;
    }

    const group = groupedByManifest.get(manifest.id) ?? [];
    group.push(source);
    groupedByManifest.set(manifest.id, group);
  }

  const tasks: SearchManifestTask[] = [];
  for (const [manifestId, selectedSources] of groupedByManifest) {
    const manifest = registry.manifests.get(manifestId);
    if (!manifest) {
      skippedSources.push({ source: manifestId, reason: "manifest-not-registered" });
      continue;
    }
    const capability = getCapability(manifestId);
    tasks.push({
      manifestId,
      displayName: manifest.displayName,
      selectedSources: [...selectedSources],
      resourceGroup: capability.resourceGroup,
      maxConcurrency: capability.maxConcurrency,
      timeoutMs: capability.timeoutMs,
      status: "planned",
    });
  }

  // Deterministic ordering: by manifest id so plans are stable across runs.
  tasks.sort((a, b) => a.manifestId.localeCompare(b.manifestId));

  const plan: SearchSourcePlan = {
    version: SOURCE_PLAN_VERSION,
    country,
    evaluationTime: new Date().toISOString(),
    tasks,
    skippedSources,
  };

  logger.info("Built job search source plan", {
    tasks: tasks.length,
    skipped: skippedSources.length,
    country: country ?? "any",
  });

  return plan;
}