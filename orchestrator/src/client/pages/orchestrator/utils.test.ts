import { createAppSettings, createJob } from "@shared/testing/factories.js";
import { describe, expect, it } from "vitest";
import { getEnabledSources, getJobCounts } from "./utils";

describe("orchestrator utils", () => {
  it("enables adzuna only when both app id and key are configured", () => {
    const withCreds = createAppSettings({
      adzunaAppId: "app-id",
      adzunaAppKeyHint: "key-",
    });
    const withoutKey = createAppSettings({
      adzunaAppId: "app-id",
      adzunaAppKeyHint: null,
    });

    expect(getEnabledSources(withCreds)).toContain("adzuna");
    expect(getEnabledSources(withoutKey)).not.toContain("adzuna");
  });

  it("enables startupjobs without credentials", () => {
    expect(getEnabledSources(createAppSettings())).toContain("startupjobs");
  });

  it("enables workingnomads without credentials", () => {
    expect(getEnabledSources(createAppSettings())).toContain("workingnomads");
  });

  it("enables golangjobs without credentials", () => {
    expect(getEnabledSources(createAppSettings())).toContain("golangjobs");
  });

  it("enables all jobboards regional sources without credentials", () => {
    const enabled = getEnabledSources(createAppSettings());
    for (const source of [
      "dice",
      "monster",
      "instahyre",
      "eluta",
      "builtin",
      "simplyhired",
      "jobbank",
      "foundit",
      "shine",
    ] as const) {
      expect(enabled).toContain(source);
    }
  });

  it("counts processing jobs only in the discovered tab", () => {
    const jobs = [
      createJob({ id: "ready", status: "ready", closedAt: null }),
      createJob({ id: "processing", status: "processing", closedAt: null }),
      createJob({ id: "discovered", status: "discovered", closedAt: null }),
      createJob({ id: "applied", status: "applied", closedAt: null }),
    ];

    // Processing jobs follow the discovered-tab filter (their first state);
    // they must NOT double-count into ready.
    expect(getJobCounts(jobs)).toEqual({
      ready: 1,
      discovered: 2,
      applied: 1,
      in_progress: 0,
      skipped: 0,
      expired: 0,
      all: 4,
    });
  });
});
