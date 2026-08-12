import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routesDir = dirname(fileURLToPath(import.meta.url));

describe("debug", () => {
  it("shows what matches", async () => {
    const entries = await readdir(routesDir, { withFileTypes: true });
    const files = entries
      .filter(
        (e) =>
          e.isFile() &&
          e.name.endsWith(".ts") &&
          !e.name.endsWith(".test.ts") &&
          e.name !== "test-utils.ts",
      )
      .map((e) => join(routesDir, e.name))
      .sort();
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      const re = /res\s*(?:\.\s*status\s*\([^)]*\))?\s*\.\s*json\s*\(/;
      if (re.test(source)) {
        // show the matched segment
        const m = source.match(re);
        offenders.push(`${file} :: matched="${m?.[0]}"`);
      }
    }
    console.log("FILES:", files.join("\n"));
    console.log("OFFENDERS:", offenders);
    expect(true).toBe(true);
  });
});
