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
  summary: string | null;
}

export interface ResumeEducationEntry {
  institution: string | null;
  degree: string | null;
  startDate: string | null;
  endDate: string | null;
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
