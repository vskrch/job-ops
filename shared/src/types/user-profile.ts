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
 * Persisted user resume profile record.
 */
export interface UserProfile extends ParsedResumeProfile {
  id: string;
  source: "pdf_upload";
  fileName: string | null;
  createdAt: string;
  updatedAt: string;
}
