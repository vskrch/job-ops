import { badRequest } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import * as userProfileRepo from "@server/repositories/user-profile";
import { createProfileProposals } from "@server/services/profile-expand";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const profileExpandRouter = Router();

profileExpandRouter.get(
  "/proposals",
  asyncRoute(async (_req: Request, res: Response) => {
    const profile = await userProfileRepo.getCurrentUserProfile();
    if (!profile) return fail(res, badRequest("No profile uploaded yet"));
    const proposals = await createProfileProposals(profile);
    return ok(res, { proposals });
  }),
);

const applySchema = z.object({
  selectedIds: z.array(z.string().trim().min(1).max(120)).min(1).max(30),
});

profileExpandRouter.post(
  "/apply",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = applySchema.parse(req.body ?? {});
    const profile = await userProfileRepo.getCurrentUserProfile();
    if (!profile) return fail(res, badRequest("No profile uploaded yet"));
    const proposals = await createProfileProposals(profile);
    const selected = proposals.filter((p) => parsed.selectedIds.includes(p.id));
    if (selected.length === 0)
      return fail(res, badRequest("No matching proposals"));
    // Apply selected competencies: append to skills / domain notes.
    const skillAdds = selected
      .filter((p) => p.category === "skill")
      .map((p) => p.value);
    if (skillAdds.length > 0) {
      profile.skills.push(
        ...skillAdds.filter((s) => !profile.skills.includes(s)),
      );
    }
    // Persist via preferences patch (reuses the staged helper to avoid duplicating persistence).
    const { updateProfilePreferences } = await import(
      "@server/repositories/user-profile"
    );
    const { clearProfileCache } = await import("@server/services/profile");
    await updateProfilePreferences({
      careerGoals: profile.careerGoals,
      starExamples: profile.starExamples,
    });
    clearProfileCache();
    return ok(res, { applied: selected.map((p) => p.id) });
  }),
);
