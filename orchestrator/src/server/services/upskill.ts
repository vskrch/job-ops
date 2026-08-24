/**
 * Upskill gap-heatmap aggregator (B3).
 *
 * This module is pure aggregation — it composes recorded gap data from the
 * scoring pipeline with an LLM synthesis pass (caller-owned) and produces a
 * ranked table. The caller persists the report via application_artifacts as
 * kind='upskill' so history is append-only.
 */

import type { ScoreBreakdown } from "@shared/score-breakdown";

export type HeatmapRow = {
  skill: string;
  priority: "Critical" | "High" | "Medium" | "Low";
  type: "Hard" | "Domain" | "Soft" | "Tooling" | "Credential";
  score: number;
  jobsAffected: number;
  provenance: string;
};

function normalizeSkill(s: string): string {
  return s.toLowerCase().trim();
}

export function buildHeatmap(
  rows: Array<{ breakdown: ScoreBreakdown | null }>,
): HeatmapRow[] {
  const freq = new Map<
    string,
    { count: number; score: number; examples: string[] }
  >();
  for (const r of rows) {
    if (!r.breakdown?.gaps?.length) continue;
    // Weight this job's gaps by (100 - overall)/100 so low-fit jobs contribute more.
    const w = (100 - (r.breakdown.overall ?? 50)) / 100;
    for (const gap of r.breakdown.gaps) {
      const key = normalizeSkill(gap);
      const cur = freq.get(key) ?? { count: 0, score: 0, examples: [] };
      cur.count += 1;
      cur.score += w;
      if (cur.examples.length < 2) cur.examples.push(gap);
      freq.set(key, cur);
    }
  }
  const out: HeatmapRow[] = Array.from(freq.entries()).map(([skill, v]) => ({
    skill,
    priority:
      v.score >= 3
        ? "Critical"
        : v.score >= 1.5
          ? "High"
          : v.score >= 0.5
            ? "Medium"
            : "Low",
    type: "Hard",
    score: Math.round(v.score * 10) / 10,
    jobsAffected: v.count,
    provenance: `${v.count} job(s) — ${v.examples.join(" · ").slice(0, 120)}`,
  }));
  return out.sort((a, b) => b.score - a.score);
}
