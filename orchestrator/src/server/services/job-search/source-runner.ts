/**
 * Manifest task execution for job search (ADR-002).
 *
 * Invokes a single manifest exactly once with the exact selected source group
 * from the search plan. Never schedules work per source ID.
 */

import { logger } from "@infra/logger";
import { getExtractorRegistry } from "@server/extractors/registry";
import * as settingsRepo from "@server/repositories/settings";
import { normalizeCountryKey } from "@shared/location-support.js";
import type {
  CreateJobInput,
  ParsedSearchSpec,
  SearchManifestResult,
  SearchManifestTask,
} from "@shared/types";

/**
 * Run one planned manifest task and return a settled, structured result.
 */
export async function runManifestTask(
  task: SearchManifestTask,
  spec: ParsedSearchSpec,
  existingJobUrls: Promise<string[]>,
  timeoutMs: number,
): Promise<SearchManifestResult> {
  const startedAt = Date.now();
  const manifestId = task.manifestId;
  const taskLogger = logger.child({ manifestId, searchPhase: "aggregating" });

  try {
    const registry = await getExtractorRegistry();
    const manifest = registry.manifests.get(manifestId);
    if (!manifest) {
      return {
        manifestId,
        displayName: task.displayName,
        selectedSources: task.selectedSources,
        jobs: [],
        status: "failed",
        error: "Extractor manifest not registered",
        durationMs: Date.now() - startedAt,
      };
    }

    const searchTerms = buildSearchTerms(spec);
    const selectedCountry = spec.location.country
      ? normalizeCountryKey(spec.location.country)
      : null;

    const settings = await settingsRepo.getAllSettings();
    const filteredSettings = Object.fromEntries(
      Object.entries(settings).filter(
        ([, value]) =>
          typeof value === "string" || typeof value === "undefined",
      ),
    ) as Record<string, string | undefined>;

    if (spec.postedWithin.value !== null) {
      const hours =
        spec.postedWithin.unit === "hours"
          ? spec.postedWithin.value
          : spec.postedWithin.unit === "days"
            ? spec.postedWithin.value * 24
            : spec.postedWithin.value * 24 * 7;
      filteredSettings.jobspyHoursOld = String(hours);
    }
    if (spec.workMode === "remote") {
      filteredSettings.jobspyIsRemote = "1";
    }

    // Drive JobSpy's country/location from the parsed spec so results are
    // scoped to the requested country instead of falling back to a default.
    const countryKey = spec.location.country
      ? normalizeCountryKey(spec.location.country)
      : null;
    if (countryKey) {
      filteredSettings.jobspyCountryIndeed = countryKey;
    }
    if (spec.location.cities.length > 0) {
      filteredSettings.searchCities = spec.location.cities.join("|");
    }

    // Coerce the task's shouldCancel hook into the extractor contract.
    let cancelled = false;
    const timer = setTimeout(() => {
      cancelled = true;
    }, timeoutMs);

    try {
      const result = await manifest.run({
        source: task.selectedSources[0] ?? manifestId,
        selectedSources: task.selectedSources,
        settings: filteredSettings,
        searchTerms,
        selectedCountry: selectedCountry ?? null,
        getExistingJobUrls: () => existingJobUrls,
        shouldCancel: () => cancelled,
        onProgress: () => {},
      });

      if (cancelled) {
        return {
          manifestId,
          displayName: task.displayName,
          selectedSources: task.selectedSources,
          jobs: [],
          status: "failed",
          error: `Timed out after ${timeoutMs}ms`,
          durationMs: Date.now() - startedAt,
        };
      }

      if (!result.success) {
        return {
          manifestId,
          displayName: task.displayName,
          selectedSources: task.selectedSources,
          jobs: [],
          status: "failed",
          error: result.error ?? "Unknown extractor error",
          durationMs: Date.now() - startedAt,
        };
      }

      taskLogger.info("Manifest task completed", {
        jobsReturned: result.jobs.length,
        durationMs: Date.now() - startedAt,
        selectedSources: task.selectedSources.length,
      });

      return {
        manifestId,
        displayName: task.displayName,
        selectedSources: task.selectedSources,
        jobs: result.jobs,
        status: "succeeded",
        error: null,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    taskLogger.warn("Manifest task failed", { error: message });
    return {
      manifestId,
      displayName: task.displayName,
      selectedSources: task.selectedSources,
      jobs: [],
      status: "failed",
      error: message,
      durationMs: Date.now() - startedAt,
    };
  }
}

function buildSearchTerms(spec: ParsedSearchSpec): string[] {
  const terms: string[] = [];
  if (spec.roles.length > 0) {
    terms.push(...spec.roles);
    if (spec.skills.length > 0) {
      const topSkills = spec.skills.slice(0, 2).join(" ");
      terms.unshift(`${spec.roles[0]} ${topSkills}`);
    }
  } else if (spec.skills.length > 0) {
    terms.push(spec.skills.join(" "));
    terms.push(...spec.skills.slice(0, 3));
  }

  if (terms.length === 0) {
    terms.push("software engineer");
  }

  return Array.from(new Set(terms.map((t) => t.trim()).filter(Boolean)));
}

export type { CreateJobInput };
