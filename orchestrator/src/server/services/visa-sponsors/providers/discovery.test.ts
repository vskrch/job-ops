import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverProviderManifestPaths,
  loadProviderManifestFromFile,
} from "./discovery";

const tempRoots: string[] = [];
const originalCwd = process.cwd();

async function makeTempRepoRoot(): Promise<string> {
  const testTmpBase = join(originalCwd, "orchestrator", ".tmp");
  await mkdir(testTmpBase, { recursive: true });
  const tempDir = await mkdtemp(join(testTmpBase, "visa-sponsor-discovery-"));
  tempRoots.push(tempDir);
  return tempDir;
}

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("visa sponsor provider discovery", () => {
  it("finds provider manifests in the repo-local providers directory", async () => {
    const repoRoot = await makeTempRepoRoot();
    const providersRoot = join(repoRoot, "visa-sponsor-providers");
    await mkdir(join(providersRoot, "ca"), { recursive: true });
    await writeFile(
      join(providersRoot, "ca", "manifest.ts"),
      [
        "export const manifest = {",
        "  id: 'ca',",
        "  displayName: 'Canada',",
        "  countryKey: 'canada',",
        "  async fetchSponsors() {",
        "    return [];",
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );

    await expect(discoverProviderManifestPaths(providersRoot)).resolves.toEqual(
      [join(providersRoot, "ca", "manifest.ts")],
    );
  });

  it("loads provider manifests from named exports", async () => {
    const repoRoot = await makeTempRepoRoot();
    const manifestPath = join(repoRoot, "provider-manifest.mjs");
    await writeFile(
      manifestPath,
      [
        "export const manifest = {",
        "  id: 'ca',",
        "  displayName: 'Canada',",
        "  countryKey: 'canada',",
        "  async fetchSponsors() {",
        "    return [];",
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );

    const manifest = await loadProviderManifestFromFile(manifestPath);

    expect(manifest.id).toBe("ca");
    expect(manifest.countryKey).toBe("canada");
  });

  it("loads provider manifests from default exports", async () => {
    const repoRoot = await makeTempRepoRoot();
    const manifestPath = join(repoRoot, "provider-manifest-default.mjs");
    await writeFile(
      manifestPath,
      [
        "export default {",
        "  id: 'ca',",
        "  displayName: 'Canada',",
        "  countryKey: 'canada',",
        "  async fetchSponsors() {",
        "    return [];",
        "  },",
        "};",
      ].join("\n"),
      "utf8",
    );

    const manifest = await loadProviderManifestFromFile(manifestPath);

    expect(manifest.id).toBe("ca");
    expect(manifest.countryKey).toBe("canada");
  });

  it("rejects invalid manifest export shapes", async () => {
    const repoRoot = await makeTempRepoRoot();
    const manifestPath = join(repoRoot, "provider-manifest-invalid.mjs");
    await writeFile(
      manifestPath,
      [
        "export default {",
        "  id: 'ca',",
        "  displayName: 'Canada',",
        "};",
      ].join("\n"),
      "utf8",
    );

    await expect(loadProviderManifestFromFile(manifestPath)).rejects.toThrow(
      `Invalid visa sponsor provider manifest in ${manifestPath}`,
    );
  });
});
