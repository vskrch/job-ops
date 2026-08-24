/**
 * Structured scoring output for a job's suitability.
 *
 * The four dimensions are 0-100 each; the weighted overall is derived as:
 * technical * 0.30 + experience * 0.25 + behavioral * 0.15 + career * 0.30.
 * The Location gate and Language Gate are PASS/FAIL/FLAG per the source
 * concept — a FAIL vetoes the job regardless of score, a FLAG propagates a
 * warning to the UI. Strengths/gaps are grounded claims for the user to act on.
 */

export type GateVerdict = "PASS" | "FAIL" | "FLAG";

export interface ScoreBreakdown {
  /** Per-dimension scores from the LLM (0-100 each). */
  technical: number;
  experience: number;
  behavioral: number;
  /** Career alignment / motivation contribution. */
  career: number;
  /** Weighted overall (derived server-side, persisted for audit). Mirrors `suitabilityScore` but explicit. */
  overall: number;
  locationVerdict: GateVerdict;
  locationNote: string | null;
  languageGate: GateVerdict;
  languageNote: string | null;
  /** Hard veto from deal-breakers listed in the profile. */
  dealBreakerHit: boolean;
  dealBreakerNote: string | null;
  strengths: string[];
  gaps: string[];
  evaluatedAt: string;
}

export const SCORE_WEIGHTS = {
  technical: 0.3,
  experience: 0.25,
  behavioral: 0.15,
  career: 0.3,
} as const;

export function computeWeightedOverall(
  technical: number,
  experience: number,
  behavioral: number,
  career: number,
): number {
  return Math.round(
    technical * SCORE_WEIGHTS.technical +
      experience * SCORE_WEIGHTS.experience +
      behavioral * SCORE_WEIGHTS.behavioral +
      career * SCORE_WEIGHTS.career,
  );
}

export function scoreToGrade(score: number): string {
  if (score >= 80) return "A";
  if (score >= 65) return "B";
  if (score >= 50) return "C";
  if (score >= 35) return "D";
  return "F";
}

export function scoreBand(overall: number): string {
  if (overall >= 75) return "Strong Fit";
  if (overall >= 60) return "Good Fit";
  if (overall >= 45) return "Moderate Fit";
  if (overall >= 30) return "Weak Fit";
  return "Poor Fit";
}
