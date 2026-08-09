import { runTalent } from "./extractors/talent/src/run.ts";
import { runAiJobs } from "./extractors/aijobs/src/run.ts";
import { runHasjob } from "./extractors/hasjob/src/run.ts";
import { runHimalayas } from "./extractors/himalayas/src/run.ts";
for (const [name, fn] of [["talent", runTalent], ["aijobs", runAiJobs], ["hasjob", runHasjob], ["himalayas", runHimalayas]]) {
  try {
    const r = await fn({ searchTerms: ["software engineer"], selectedCountry: "United States", maxJobsPerTerm: 5 });
    console.log(`== ${name}: success=${r.success} jobs=${r.jobs.length} err=${(r.error ?? "none").slice(0, 120)}`);
    console.log("   sample:", JSON.stringify(r.jobs[0] ?? {}).slice(0, 260));
  } catch (e) {
    console.log(`== ${name}: THREW ${e instanceof Error ? e.message : String(e)}`);
  }
}
