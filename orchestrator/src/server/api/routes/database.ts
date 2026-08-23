import { forbidden, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { isDemoMode, sendDemoBlocked } from "@server/config/demo";
import { clearDatabase } from "@server/db/clear";
import { countRegisteredUsers } from "@server/services/auth";
import { type Request, type Response, Router } from "express";

export const databaseRouter = Router();

/**
 * DELETE /api/database - Clear all data from the database
 */
databaseRouter.delete("/", async (_req: Request, res: Response) => {
  try {
    if (isDemoMode()) {
      return sendDemoBlocked(
        res,
        "Clearing the database is disabled in the public demo.",
        { route: "DELETE /api/database" },
      );
    }

    // The wipe is global (every tenant's rows); only single-user installs
    // may trigger it. Multi-user instances must clear per-account data.
    const registeredUsers = await countRegisteredUsers();
    if (registeredUsers > 1) {
      return fail(
        res,
        forbidden(
          "Clearing the database is disabled on multi-user installs because it would erase every account's data.",
        ),
      );
    }

    const result = clearDatabase();

    ok(res, {
      message: "Database cleared",
      jobsDeleted: result.jobsDeleted,
      runsDeleted: result.runsDeleted,
    });
  } catch (error) {
    fail(res, toAppError(error));
  }
});
