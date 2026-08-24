import { logger } from "@infra/logger";
import * as userProfileRepo from "@server/repositories/user-profile";
import { getProfile } from "@server/services/profile";

export async function loadProfileStep(): Promise<Record<string, unknown>> {
  logger.info("Loading profile");
  try {
    const profile = (await getProfile()) as unknown as Record<string, unknown>;
    try {
      const userProfile = await userProfileRepo.getCurrentUserProfile();
      if (userProfile) {
        (profile as Record<string, unknown>).languageLevels =
          userProfile.languageLevels;
        (profile as Record<string, unknown>).dealBreakers =
          userProfile.dealBreakers;
        (profile as Record<string, unknown>).careerGoals =
          userProfile.careerGoals;
        (profile as Record<string, unknown>).behavioralNotes =
          userProfile.behavioralNotes;
        (profile as Record<string, unknown>).starExamples =
          userProfile.starExamples;
      }
    } catch {
      // Preferences are optional — keep scoring functional without them.
    }
    return profile;
  } catch (error) {
    logger.warn(
      "Failed to load profile for scoring, using empty profile",
      error,
    );
    return {} as Record<string, unknown>;
  }
}
