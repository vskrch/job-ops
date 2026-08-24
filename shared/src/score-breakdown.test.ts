import {
  computeWeightedOverall,
  type GateVerdict,
  scoreBand,
  scoreToGrade,
} from "@shared/score-breakdown";
import { describe, expect, it } from "vitest";

describe("computeWeightedOverall", () => {
  it("weights dimensions: 30/25/15/30 sum to 100", () => {
    expect(computeWeightedOverall(100, 100, 100, 100)).toBe(100);
    expect(computeWeightedOverall(0, 0, 0, 0)).toBe(0);
    expect(computeWeightedOverall(80, 80, 80, 80)).toBe(80);
  });

  it("rounds the weighted average", () => {
    // 10*0.3 + 20*0.25 + 30*0.15 + 40*0.30 = 3 + 5 + 4.5 + 12 = 24.5 → 25
    expect(computeWeightedOverall(10, 20, 30, 40)).toBe(25);
  });
});

describe("scoreToGrade", () => {
  it("maps score bands to grades", () => {
    expect(scoreToGrade(80)).toBe("A");
    expect(scoreToGrade(65)).toBe("B");
    expect(scoreToGrade(50)).toBe("C");
    expect(scoreToGrade(35)).toBe("D");
    expect(scoreToGrade(34)).toBe("F");
  });
});

describe("scoreBand", () => {
  it("maps to band labels", () => {
    expect(scoreBand(75)).toBe("Strong Fit");
    expect(scoreBand(60)).toBe("Good Fit");
    expect(scoreBand(45)).toBe("Moderate Fit");
    expect(scoreBand(30)).toBe("Weak Fit");
    expect(scoreBand(29)).toBe("Poor Fit");
  });
});

// Smoke the gate verdict enum — guards the coupling that scoring, ranking
// and the UI share one set of PASS/FAIL/FLAG values.
describe("GateVerdict", () => {
  it("only allows PASS/FAIL/FLAG", () => {
    const ok: GateVerdict = "PASS";
    void ok;
    void ("FLAG" as GateVerdict);
    void ("FAIL" as GateVerdict);
  });
});
