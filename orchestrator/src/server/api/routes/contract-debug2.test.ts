import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const routesDir = dirname(fileURLToPath(import.meta.url));

describe("debug2", () => {
  it("shows success offenders", async () => {
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
      if (/\bsuccess\s*:/.test(source)) offenders.push(file);
    }
    console.log("SUCCESS OFFENDERS:", offenders);
    expect(true).toBe(true);
  });
});
