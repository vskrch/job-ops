/**
 * User profile repository — data access for uploaded resume profiles.
 */

import { randomUUID } from "node:crypto";
import { getCurrentUserId } from "@infra/request-context";
import type { ParsedResumeProfile, UserProfile } from "@shared/types";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index";

const { userProfiles } = schema;

function currentUserId(): string {
  return getCurrentUserId();
}

function mapRowToUserProfile(
  row: typeof userProfiles.$inferSelect,
): UserProfile {
  const rawExperience =
    (row.experience as UserProfile["experience"] | null) ?? [];
  const rawProjects = (row.projects as UserProfile["projects"] | null) ?? [];
  // Backfill `bullets` on legacy rows (older uploads predate the schema
  // change). Split any single-line `summary` into bullets so the rendered
  // PDF shows real bullet points instead of a one-liner per job.
  const experience = rawExperience.map((e) => {
    const bullets = e.bullets ?? [];
    if (bullets.length > 0 || !e.summary) return e;
    return { ...e, bullets: [e.summary] };
  });
  const projects = rawProjects.map((p) => {
    const bullets = p.bullets ?? [];
    if (bullets.length > 0 || !p.description) return p;
    return { ...p, bullets: [p.description] };
  });
  return {
    id: row.id,
    source: "pdf_upload",
    fullName: row.fullName,
    email: row.email,
    phone: row.phone,
    location: row.location,
    headline: row.headline,
    summary: row.summary,
    skills: (row.skills as string[] | null) ?? [],
    experience,
    education: (row.education as UserProfile["education"] | null) ?? [],
    projects,
    certifications: (row.certifications as string[] | null) ?? [],
    languages: (row.languages as string[] | null) ?? [],
    links: (row.links as UserProfile["links"] | null) ?? [],
    languageLevels:
      (row.languageLevels as UserProfile["languageLevels"] | null) ?? [],
    dealBreakers: (row.dealBreakers as string[] | null) ?? [],
    careerGoals: (row.careerGoals as string[] | null) ?? [],
    behavioralNotes: row.behavioralNotes ?? null,
    starExamples:
      (row.starExamples as UserProfile["starExamples"] | null) ?? [],
    fileName: row.fileName,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Insert (or replace) the user's resume profile. Only one profile exists per
 * user — a new upload overwrites the previous one.
 */
export async function upsertUserProfile(args: {
  profile: ParsedResumeProfile;
  fileName: string | null;
}): Promise<UserProfile> {
  const now = new Date().toISOString();
  const userId = currentUserId();

  const existing = await db
    .select({ id: userProfiles.id })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const id = existing[0]?.id ?? randomUUID();

  await db
    .insert(userProfiles)
    .values({
      id,
      userId,
      source: "pdf_upload",
      fullName: args.profile.fullName,
      email: args.profile.email,
      phone: args.profile.phone,
      location: args.profile.location,
      headline: args.profile.headline,
      summary: args.profile.summary,
      skills: args.profile.skills,
      experience: args.profile.experience,
      education: args.profile.education,
      projects: args.profile.projects,
      certifications: args.profile.certifications,
      languages: args.profile.languages,
      links: args.profile.links,
      fileName: args.fileName,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: userProfiles.id,
      set: {
        source: "pdf_upload",
        fullName: args.profile.fullName,
        email: args.profile.email,
        phone: args.profile.phone,
        location: args.profile.location,
        headline: args.profile.headline,
        summary: args.profile.summary,
        skills: args.profile.skills,
        experience: args.profile.experience,
        education: args.profile.education,
        projects: args.profile.projects,
        certifications: args.profile.certifications,
        languages: args.profile.languages,
        links: args.profile.links,
        fileName: args.fileName,
        updatedAt: now,
      },
    });

  const [row] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.id, id))
    .limit(1);
  return mapRowToUserProfile(row);
}

/** Get the current user's uploaded resume profile, if any. */
export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const [row] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, currentUserId()))
    .orderBy(userProfiles.updatedAt)
    .limit(1);
  return row ? mapRowToUserProfile(row) : null;
}

/** Delete the current user's uploaded resume profile. */
export async function deleteCurrentUserProfile(): Promise<boolean> {
  const result = await db
    .delete(userProfiles)
    .where(eq(userProfiles.userId, currentUserId()));
  return result.changes > 0;
}

export interface ProfilePreferencesUpdate {
  languageLevels?: UserProfile["languageLevels"];
  dealBreakers?: string[];
  careerGoals?: string[];
  behavioralNotes?: string | null;
  starExamples?: UserProfile["starExamples"];
}

/**
 * Update career-preference fields for the current user's profile. Distinct
 * from the resume upload path on purpose: re-uploading a PDF refreshes the
 * resume-derived fields but must never wipe user-curated preferences.
 * Returns false when no profile exists yet.
 */
export async function updateProfilePreferences(
  update: ProfilePreferencesUpdate,
): Promise<boolean> {
  const userId = currentUserId();
  const set: Record<string, unknown> = {
    updatedAt: new Date().toISOString(),
  };
  if (update.languageLevels !== undefined)
    set.languageLevels = update.languageLevels;
  if (update.dealBreakers !== undefined) set.dealBreakers = update.dealBreakers;
  if (update.careerGoals !== undefined) set.careerGoals = update.careerGoals;
  if (update.behavioralNotes !== undefined)
    set.behavioralNotes = update.behavioralNotes;
  if (update.starExamples !== undefined) set.starExamples = update.starExamples;

  const result = await db
    .update(userProfiles)
    .set(set)
    .where(eq(userProfiles.userId, userId));
  return result.changes > 0;
}
