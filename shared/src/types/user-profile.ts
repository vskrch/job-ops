/**
 * User resume profile types.
 *
 * A lean, structured representation of the user's uploaded resume (PDF).
 * `ParsedResumeProfile` is the LLM extraction output; `UserProfile` adds the
 * persisted record fields.
 */

export interface ResumeExperienceEntry {
  company: string | null;
  position: string | null;
  startDate: string | null;
  endDate: string | null;
  /** Free-form paragraph summary (legacy field). */
  summary: string | null;
  /**
   * Preserved bullet points from the resume, one per line/role. When the
   * LLM can split the source PDF into discrete bullets, they end up
   * here. When it returns a single summary, we split it post-hoc in
   * `profileToResumeProfile` so the rendered PDF shows individual
   * achievements rather than a single squashed line.
   */
  bullets: string[];
  location?: string | null;
}

export interface ResumeEducationEntry {
  institution: string | null;
  degree: string | null;
  startDate: string | null;
  endDate: string | null;
  description?: string | null;
  grade?: string | null;
}

export interface ResumeProjectEntry {
  name: string | null;
  description: string | null;
  bullets: string[];
  url?: string | null;
  date?: string | null;
}

export interface ResumeLinkEntry {
  label: string | null;
  url: string | null;
}

/**
 * Structured profile extracted from an uploaded resume PDF.
 */
export interface ParsedResumeProfile {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  headline: string | null;
  summary: string | null;
  skills: string[];
  experience: ResumeExperienceEntry[];
  education: ResumeEducationEntry[];
  /** Optional project entries the LLM can extract from the resume. */
  projects: ResumeProjectEntry[];
  certifications: string[];
  languages: string[];
  links: ResumeLinkEntry[];
}

/**
 * A language the user works in, with an optional free-text proficiency level
 * ("native", "fluent", "B2", ...). Levels are intentionally free-form: CEFR
 * letters, LinkedIn-style buckets and plain words all appear on resumes, and
 * the scoring Language Gate reasons about them rather than forcing a scale.
 */
export interface ProfileLanguage {
  name: string;
  level: string | null;
}

/**
 * A STAR interview story bank entry. `useFor` tags map the example onto
 * question types for interview prep ("conflict", "leadership", ...).
 */
export interface StarExample {
  id: string;
  title: string;
  /** Question types this story answers, e.g. "conflict", "failure". */
  useFor: string[];
  situation: string;
  task: string;
  action: string;
  result: string;
}

/**
 * Persisted user resume profile record.
 */
export interface UserProfile extends ParsedResumeProfile {
  id: string;
  source: "pdf_upload";
  /**
   * Languages with optional proficiency levels. Drives the scoring Language
   * Gate: an undeclared required language is a FAIL; a declared language with
   * a higher required level is a FLAG. `languages` stays the renderer-facing
   * plain list; this is the evaluation-facing structure.
   */
  languageLevels: ProfileLanguage[];
  /** Hard "no" conditions (e.g. "no on-call", "no relocation without help"). */
  dealBreakers: string[];
  /** What the user wants next — feeds fit scoring's career dimension. */
  careerGoals: string[];
  /** Free-form behavioral notes (thrives on / drains / collaboration style). */
  behavioralNotes: string | null;
  /** STAR interview stories built from real experience. */
  starExamples: StarExample[];
  fileName: string | null;
  createdAt: string;
  updatedAt: string;
}
