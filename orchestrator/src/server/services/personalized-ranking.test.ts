import type { CreateJobInput } from "@shared/types";
import { describe, expect, it } from "vitest";
import {
  blendProfileScore,
  computeProfileMatchScore,
} from "./personalized-ranking";

function makeJob(overrides: Partial<CreateJobInput> = {}): CreateJobInput {
  return {
    source: "adzuna",
    title: "Data Engineer",
    employer: "Acme",
    jobUrl: "https://example.com/job-1",
    location: "London",
    skills: "Python, SQL",
    jobDescription: "Build data pipelines with Python and SQL.",
    ...overrides,
  };
}

const LEAN_PROFILE = {
  fullName: "Jane Doe",
  headline: "Data Engineer",
  summary: "Data engineer",
  skills: ["Python", "SQL", "AWS"],
  location: "London",
};

describe("computeProfileMatchScore", () => {
  it("returns 0 when no profile signals are available", () => {
    expect(computeProfileMatchScore(makeJob(), null)).toBe(0);
    expect(computeProfileMatchScore(makeJob(), undefined)).toBe(0);
    expect(computeProfileMatchScore(makeJob(), {})).toBe(0);
  });

  it("rewards matching skills in the job title and description", () => {
    const match = computeProfileMatchScore(makeJob(), LEAN_PROFILE);
    const unrelated = computeProfileMatchScore(
      makeJob({
        title: "Warehouse Operator",
        jobDescription: "Stack shelves and operate forklifts.",
        skills: "Health and safety",
      }),
      LEAN_PROFILE,
    );
    expect(match).toBeGreaterThan(unrelated);
  });

  it("rewards matching location", () => {
    const london = computeProfileMatchScore(
      makeJob({ location: "London" }),
      LEAN_PROFILE,
    );
    const remote = computeProfileMatchScore(
      makeJob({ location: "Manchester" }),
      LEAN_PROFILE,
    );
    expect(london).toBeGreaterThan(remote);
  });

  it("scores the full match higher than a partial one", () => {
    const full = computeProfileMatchScore(makeJob(), LEAN_PROFILE);
    const partial = computeProfileMatchScore(
      makeJob({ title: "Analyst", jobDescription: "Excel reports" }),
      { ...LEAN_PROFILE, skills: ["Excel"] },
    );
    expect(full).toBeGreaterThan(partial);
    expect(full).toBeGreaterThanOrEqual(0);
    expect(full).toBeLessThanOrEqual(100);
  });

  it("supports ResumeProfile-shaped input", () => {
    const resumeProfile = {
      basics: {
        name: "Jane Doe",
        label: "Data Engineer",
        location: { city: "London" },
      },
      sections: {
        skills: {
          items: [
            { name: "Python", keywords: [] },
            { name: "SQL", keywords: [] },
          ],
        },
      },
    } as unknown as import("@shared/types").ResumeProfile;
    const score = computeProfileMatchScore(makeJob(), resumeProfile);
    expect(score).toBeGreaterThan(0);
  });
});

describe("blendProfileScore", () => {
  it("returns the relevance score unchanged without a profile", () => {
    expect(blendProfileScore(80, 90, "explanation", false)).toEqual({
      score: 80,
      explanation: "explanation",
    });
  });

  it("returns the relevance score unchanged when profile score is 0", () => {
    expect(blendProfileScore(80, 0, "explanation", true)).toEqual({
      score: 80,
      explanation: "explanation",
    });
  });

  it("blends 70/30 and annotates the explanation", () => {
    const blended = blendProfileScore(80, 40, "Good role", true);
    expect(blended.score).toBe(68); // round(80*0.7 + 40*0.3)
    expect(blended.explanation).toContain("[Profile match: 40/100]");
  });

  it("clamps nothing outside 0-100 for valid inputs", () => {
    const blended = blendProfileScore(100, 100, "", true);
    expect(blended.score).toBe(100);
  });
});
