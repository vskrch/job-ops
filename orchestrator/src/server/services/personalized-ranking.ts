/**
 * Personalized profile-match scoring.
 *
 * Deterministic heuristic that scores how well a job matches the user's
 * profile (from an uploaded resume or the base resume). Used to blend with
 * LLM relevance in ranking: final = 70% relevance + 30% profile match.
 *
 * Signals:
 *   - title/label vs job title (0-40)
 *   - skills overlap with job title + description (0-40)
 *   - location match (0-20)
 */

import type { CreateJobInput, ResumeProfile, UserProfile } from "@shared/types";

export type ProfileLike = Pick<
  UserProfile,
  "fullName" | "headline" | "summary" | "skills" | "location"
>;

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim();
}

function extractProfileSignals(
  profile: ResumeProfile | UserProfile | ProfileLike | null | undefined,
): { headline: string; skills: string[]; location: string } {
  if (!profile) {
    return { headline: "", skills: [], location: "" };
  }
  if ("skills" in profile && Array.isArray(profile.skills)) {
    const lean = profile as UserProfile;
    return {
      headline: normalize(lean.headline),
      skills: lean.skills.map(normalize).filter(Boolean),
      location: normalize(lean.location),
    };
  }
  const resume = profile as ResumeProfile;
  const skillItems =
    resume.sections?.skills && typeof resume.sections.skills === "object"
      ? ((resume.sections.skills as { items?: Array<{ name?: string }> })
          .items ?? [])
      : [];
  return {
    headline: normalize(resume.basics?.label ?? resume.basics?.name),
    skills: skillItems.map((item) => normalize(item.name)).filter(Boolean),
    location: normalize(
      resume.basics?.location?.address ?? resume.basics?.location?.city ?? "",
    ),
  };
}

function scoreTitleMatch(
  jobTitle: string,
  headline: string,
  skills: string[],
): number {
  const title = normalize(jobTitle);
  if (!title) return 0;

  let score = 0;
  const titleWords = title.split(/\W+/).filter((w) => w.length > 2);

  if (headline && (title.includes(headline) || headline.includes(title))) {
    score += 25;
  }
  for (const word of titleWords) {
    if (headline.includes(word)) {
      score += 10;
      break;
    }
  }

  const matchedSkill = skills.find((skill) => {
    const compact = skill.replace(/\s+/g, "");
    return (
      compact.length >= 4 && (title.includes(compact) || title.includes(skill))
    );
  });
  if (matchedSkill) score += 15;

  return Math.min(40, score);
}

function scoreSkillMatch(job: CreateJobInput, skills: string[]): number {
  if (skills.length === 0) return 0;
  const haystack = `${normalize(job.title)} ${normalize(job.skills)} ${normalize(job.jobDescription ?? "")}`;
  if (!haystack) return 0;

  let matched = 0;
  for (const skill of skills) {
    if (skill.length < 3) continue;
    const compact = skill.replace(/\s+/g, "");
    if (compact.length >= 6) {
      if (haystack.includes(compact) || haystack.includes(skill)) matched += 1;
    } else if (haystack.includes(skill)) {
      matched += 1;
    }
  }
  if (matched === 0) return 0;
  const ratio = matched / Math.min(skills.length, 8);
  return Math.min(40, Math.round(ratio * 40));
}

function scoreLocationMatch(
  job: CreateJobInput,
  profileLocation: string,
): number {
  if (!profileLocation) return 10; // Unknown location: neutral, not a penalty
  const jobLocation = normalize(job.companyAddresses ?? job.location ?? "");
  if (!jobLocation) return 10;

  const profileCity = profileLocation.split(",")[0]?.trim() ?? "";
  const jobCity = jobLocation.split(",")[0]?.trim() ?? "";

  if (profileCity && jobCity && profileCity === jobCity) return 20;
  if (
    profileLocation.split(",").some((part) => jobLocation.includes(part.trim()))
  ) {
    return 20;
  }
  return 5;
}

/**
 * Compute a 0-100 deterministic profile-match score for a job.
 */
export function computeProfileMatchScore(
  job: CreateJobInput,
  profile: ResumeProfile | UserProfile | ProfileLike | null | undefined,
): number {
  const { headline, skills, location } = extractProfileSignals(profile);
  if (!headline && skills.length === 0 && !location) {
    return 0;
  }
  return Math.round(
    scoreTitleMatch(job.title, headline, skills) +
      scoreSkillMatch(job, skills) +
      scoreLocationMatch(job, location),
  );
}

/**
 * Blend LLM relevance (70%) with profile match (30%). Returns the blended
 * score and an updated explanation when profile data was available.
 */
export function blendProfileScore(
  relevanceScore: number,
  profileScore: number,
  explanation: string,
  hasProfile: boolean,
): { score: number; explanation: string } {
  if (!hasProfile || profileScore <= 0) {
    return { score: relevanceScore, explanation };
  }
  const score = Math.round(relevanceScore * 0.7 + profileScore * 0.3);
  return {
    score,
    explanation: `${explanation} [Profile match: ${profileScore}/100]`,
  };
}
