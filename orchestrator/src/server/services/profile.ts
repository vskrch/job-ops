import { conflict } from "@infra/errors";
import { logger } from "@infra/logger";
import { getCurrentUserId } from "@infra/request-context";
import * as userProfileRepo from "@server/repositories/user-profile";
import type { ResumeProfile } from "@shared/types";
import {
  designResumeToProfile,
  isLegacyDesignResumeError,
} from "./design-resume";
import { profileToResumeProfile } from "./resume-parser";
import { getResume, RxResumeAuthConfigError } from "./rxresume";
import { getConfiguredRxResumeBaseResumeId } from "./rxresume/baseResumeId";

interface ProfileCacheEntry {
  profile: ResumeProfile | null;
  resumeId: string | null;
  localProfile: ResumeProfile | null;
}

const profileCache = new Map<string, ProfileCacheEntry>();

function getProfileCache(): ProfileCacheEntry {
  const userId = getCurrentUserId();
  let cached = profileCache.get(userId);
  if (!cached) {
    cached = { profile: null, resumeId: null, localProfile: null };
    profileCache.set(userId, cached);
  }
  return cached;
}

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
  const cached = getProfileCache();

  if (cached.localProfile && !forceRefresh) {
    return cached.localProfile;
  }

  try {
    const localProfile = await designResumeToProfile();
    if (localProfile) {
      cached.localProfile = localProfile;
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
      cached.localProfile = converted;
      return converted;
    }
  } catch (error) {
    logger.warn("Failed to load uploaded resume profile fallback", { error });
  }

  const { resumeId: rxresumeBaseResumeId } =
    await getConfiguredRxResumeBaseResumeId();

  if (!rxresumeBaseResumeId) {
    throw conflict(
      "No resume configured. Upload a PDF resume (or configure a Design Resume) in Settings.",
    );
  }

  // Return cached profile if valid
  if (
    cached.profile &&
    cached.resumeId === rxresumeBaseResumeId &&
    !forceRefresh
  ) {
    return cached.profile;
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

    cached.profile = resume.data as unknown as ResumeProfile;
    cached.resumeId = rxresumeBaseResumeId;
    logger.info("Profile loaded from Reactive Resume", {
      resumeId: rxresumeBaseResumeId,
    });
    return cached.profile;
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
 * Get the base resume profile, falling back to an empty object if no resume is configured.
 */
export async function getProfileOrEmpty(
  forceRefresh = false,
): Promise<ResumeProfile> {
  try {
    return await getProfile(forceRefresh);
  } catch (error) {
    logger.info(
      "No base resume configured, proceeding with empty profile fallback",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return {} as ResumeProfile;
  }
}

/**
 * Clear the profile cache.
 */
export function clearProfileCache(): void {
  profileCache.delete(getCurrentUserId());
}
