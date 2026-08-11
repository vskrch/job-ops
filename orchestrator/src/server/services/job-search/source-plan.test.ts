/**
 * Tests for the manifest execution planner (ADR-002).
 *
 * Core guarantee: sources are grouped by manifest so each multi-source
 * manifest is planned exactly once with its exact selected source group.
 */

import type { ExtractorRegistry } from "@server/extractors/registry";
import type { ExtractorSourceId } from "@shared/extractors";
import type { ExtractorManifest, ParsedSearchSpec } from "@shared/types";
import { describe, expect, it } from "vitest";
import { buildSourcePlan } from "./source-plan";

function makeSpec(overrides: Partial<ParsedSearchSpec> = {}): ParsedSearchSpec {
  return {
    roles: ["Data Engineer"],
    skills: [],
    location: { country: "Canada", cities: ["Toronto"] },
    workMode: "remote",
    employmentType: null,
    experience: { minYears: null, maxYears: null },
    salary: { min: null, max: null, currency: null },
    postedWithin: { value: null, unit: null },
    excludeTerms: [],
    seniority: null,
    industry: null,
    interpretation: "",
    confidence: "high",
    explicitConstraints: [],
    inferredPreferences: [],
    ...overrides,
  };
}

function makeManifest(id: string, sources: string[]): ExtractorManifest {
  return {
    id,
    displayName: id,
    providesSources: sources,
    run: async () => ({ success: true, jobs: [] }),
  } as ExtractorManifest;
}

function makeRegistry(entries: Array<[string, string[]]>): ExtractorRegistry {
  const manifests = new Map(
    entries.map(([id, sources]) => [id, makeManifest(id, sources)]),
  );
  const manifestBySource = new Map<string, ExtractorManifest>();
  for (const [id, sources] of entries) {
    const manifest = manifests.get(id);
    if (!manifest) continue;
    for (const source of sources) {
      manifestBySource.set(source, manifest);
    }
  }
  return {
    manifests,
    manifestBySource: manifestBySource as ExtractorRegistry["manifestBySource"],
    availableSources: [...manifestBySource.keys()] as ExtractorSourceId[],
  };
}

describe("buildSourcePlan", () => {
  it("groups multi-source manifests into exactly one task each with exact selected sources", async () => {
    const registry = makeRegistry([
      ["jobspy", ["indeed", "linkedin", "glassdoor"]],
      ["ats", ["greenhouse", "lever"]],
      ["remotive", ["remotive"]],
    ]);

    const plan = await buildSourcePlan(makeSpec(), registry, {});

    expect(plan.tasks).toHaveLength(3);
    const jobspy = plan.tasks.find((t) => t.manifestId === "jobspy");
    const ats = plan.tasks.find((t) => t.manifestId === "ats");
    expect(jobspy?.selectedSources).toEqual([
      "indeed",
      "linkedin",
      "glassdoor",
    ]);
    expect(ats?.selectedSources).toEqual(["greenhouse", "lever"]);
  });

  it("skips country-restricted sources for a Canada search", async () => {
    const registry = makeRegistry([
      ["jobboards", ["dice", "instahyre"]],
      ["remotive", ["remotive"]],
    ]);

    const plan = await buildSourcePlan(makeSpec(), registry, {});

    const dice = plan.tasks.find((t) => t.manifestId === "jobboards");
    const skipped = plan.skippedSources.find((s) => s.source === "dice");
    expect(dice).toBeUndefined();
    expect(skipped?.reason).toBe("country");
    expect(plan.tasks.some((t) => t.manifestId === "remotive")).toBe(true);
  });

  it("skips sources whose required credentials are absent", async () => {
    const registry = makeRegistry([
      ["adzuna", ["adzuna"]],
      ["remotive", ["remotive"]],
    ]);

    // No ADZUNA_APP_ID / settings in this environment.
    delete process.env.ADZUNA_APP_ID;
    delete process.env.ADZUNA_APP_KEY;

    const plan = await buildSourcePlan(makeSpec(), registry, {});

    const adzuna = plan.tasks.find((t) => t.manifestId === "adzuna");
    const skipped = plan.skippedSources.find((s) => s.source === "adzuna");
    expect(adzuna).toBeUndefined();
    expect(skipped?.reason).toBe("credentials");
    expect(plan.tasks.some((t) => t.manifestId === "remotive")).toBe(true);
  });

  it("includes credential-gated sources when env credentials exist", async () => {
    const registry = makeRegistry([["adzuna", ["adzuna"]]]);
    process.env.ADZUNA_APP_ID = "test-id";
    process.env.ADZUNA_APP_KEY = "test-key";

    const plan = await buildSourcePlan(makeSpec(), registry, {});
    expect(plan.tasks.some((t) => t.manifestId === "adzuna")).toBe(true);
  });

  it("keeps all sources when no country is specified", async () => {
    const registry = makeRegistry([
      ["gradcracker", ["gradcracker"]],
      ["remotive", ["remotive"]],
    ]);

    const spec = makeSpec({ location: { country: null, cities: [] } });
    const plan = await buildSourcePlan(spec, registry, {});

    expect(plan.tasks.map((t) => t.manifestId).sort()).toEqual([
      "gradcracker",
      "remotive",
    ]);
  });

  it("assigns resource groups from the capability map", async () => {
    const registry = makeRegistry([
      ["jobspy", ["indeed"]],
      ["ats", ["greenhouse"]],
      ["unknown-future", ["future-source"]],
    ]);

    const plan = await buildSourcePlan(makeSpec(), registry, {});

    const jobspy = plan.tasks.find((t) => t.manifestId === "jobspy");
    const ats = plan.tasks.find((t) => t.manifestId === "ats");
    const unknown = plan.tasks.find((t) => t.manifestId === "unknown-future");
    expect(jobspy?.resourceGroup).toBe("subprocess-heavy");
    expect(jobspy?.maxConcurrency).toBe(1);
    expect(ats?.resourceGroup).toBe("api-light");
    // Unknown manifests default to the conservative concurrency of 1.
    expect(unknown?.resourceGroup).toBe("api-light");
    expect(unknown?.maxConcurrency).toBe(1);
  });

  it("produces a deterministic task order and persisted plan version", async () => {
    const registry = makeRegistry([
      ["remotive", ["remotive"]],
      ["ats", ["greenhouse"]],
    ]);

    const plan = await buildSourcePlan(makeSpec(), registry, {});
    const plan2 = await buildSourcePlan(makeSpec(), registry, {});

    expect(plan.tasks.map((t) => t.manifestId)).toEqual(
      plan2.tasks.map((t) => t.manifestId),
    );
    expect(plan.version).toBe("1");
    expect(plan.evaluationTime).toBeTruthy();
  });
});
