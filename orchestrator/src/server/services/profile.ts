import { conflict } from "@infra/errors";
import { logger } from "@infra/logger";
import * as userProfileRepo from "@server/repositories/user-profile";
import type { ResumeProfile } from "@shared/types";
import {
  designResumeToProfile,
  isLegacyDesignResumeError,
} from "./design-resume";
import { profileToResumeProfile } from "./resume-parser";
import { getResume, RxResumeAuthConfigError } from "./rxresume";
import { getConfiguredRxResumeBaseResumeId } from "./rxresume/baseResumeId";

let cachedProfile: ResumeProfile | null = null;
let cachedResumeId: string | null = null;
let cachedLocalProfile: ResumeProfile | null = null;

/**
 * Get the base resume profile from RxResume.
 *
 * Requires rxresumeBaseResumeId to be configured in settings.
 * Results are cached until clearProfileCache() is called.
 *
 * @param forceRefresh Force reload from API.
 * @throws Error if rxresumeBaseResumeId is not configured or API call fails.
 */
export async function getProfile(forceRefresh = false): Promise<ResumeProfile> {
  if (cachedLocalProfile && !forceRefresh) {
    return cachedLocalProfile;
  }

  try {
    const localProfile = await designResumeToProfile();
    if (localProfile) {
      cachedLocalProfile = localProfile;
      return localProfile;
    }
  } catch (error) {
    if (!isLegacyDesignResumeError(error)) {
      throw error;
    }
    logger.warn(
      "Ignoring legacy local Design Resume while loading profile fallback",
      {
        error,
      },
    );
  }

  // Fallback: an uploaded PDF resume (Settings → Resume) converted to the
  // base resume format. Lets scoring and tailoring work before a Design
  // Resume or Reactive Resume is configured. Never breaks the normal flow:
  // any failure (e.g. missing table on a fresh database) falls through.
  try {
    const uploadedProfile = await userProfileRepo.getCurrentUserProfile();
    if (uploadedProfile) {
      const converted = profileToResumeProfile(uploadedProfile);
      cachedLocalProfile = converted;
      return converted;
    }
  } catch (error) {
    logger.warn("Failed to load uploaded resume profile fallback", { error });
  }

  const { resumeId: rxresumeBaseResumeId } =
    await getConfiguredRxResumeBaseResumeId();

  if (!rxresumeBaseResumeId) {
    throw conflict(
      "No resume configured. Create a Design Resume (Design Resume tab → Start from scratch) or connect Reactive Resume in Settings.",
    );
  }

  // Return cached profile if valid
  if (
    cachedProfile &&
    cachedResumeId === rxresumeBaseResumeId &&
    !forceRefresh
  ) {
    return cachedProfile;
  }

  try {
    logger.info("Fetching profile from Reactive Resume", {
      resumeId: rxresumeBaseResumeId,
    });
    const resume = forceRefresh
      ? await getResume(rxresumeBaseResumeId, { forceRefresh: true })
      : await getResume(rxresumeBaseResumeId);

    if (!resume.data || typeof resume.data !== "object") {
      throw new Error("Resume data is empty or invalid");
    }

    cachedProfile = resume.data as unknown as ResumeProfile;
    cachedResumeId = rxresumeBaseResumeId;
    logger.info("Profile loaded from Reactive Resume", {
      resumeId: rxresumeBaseResumeId,
    });
    return cachedProfile;
  } catch (error) {
    if (error instanceof RxResumeAuthConfigError) {
      throw new Error(error.message);
    }
    logger.error("Failed to load profile from Reactive Resume", {
      resumeId: rxresumeBaseResumeId,
      error,
    });
    throw error;
  }
}

/**
 * Get the person's name from the profile.
 */
export async function getPersonName(): Promise<string> {
  const profile = await getProfile();
  return profile?.basics?.name || "Resume";
}

/**
 * Clear the profile cache.
 */
export function clearProfileCache(): void {
  cachedProfile = null;
  cachedResumeId = null;
  cachedLocalProfile = null;
}
