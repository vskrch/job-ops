import { badRequest, forbidden, notFound } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import { isDemoMode, sendDemoBlocked } from "@server/config/demo";
import { countRegisteredUsers } from "@server/services/auth";
import {
  createBackup,
  deleteBackup,
  getNextBackupTime,
  listBackups,
} from "@server/services/backup/index";
import { type Request, type Response, Router } from "express";

export const backupRouter = Router();

/**
 * Backups snapshot the whole database file (every account's rows and
 * credentials), so manual create/delete is limited to single-user installs.
 */
async function rejectMultiUserInstall(res: Response): Promise<boolean> {
  const registeredUsers = await countRegisteredUsers();
  if (registeredUsers > 1) {
    fail(
      res,
      forbidden(
        "Manual backup management is disabled on multi-user installs because backups contain every account's data.",
      ),
    );
    return true;
  }
  return false;
}

/**
 * GET /api/backups - List all backups with metadata
 */
backupRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    try {
      const backups = await listBackups();
      const nextScheduled = getNextBackupTime();
      ok(res, { backups, nextScheduled });
    } catch (error) {
      logger.error("Failed to list backups", {
        route: "GET /api/backups",
        error,
      });
      throw error;
    }
  }),
);

/**
 * POST /api/backups - Create a manual backup
 */
backupRouter.post(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    try {
      if (isDemoMode()) {
        return sendDemoBlocked(
          res,
          "Manual backup creation is disabled in the public demo.",
          { route: "POST /api/backups" },
        );
      }

      if (await rejectMultiUserInstall(res)) return;

      const filename = await createBackup("manual");
      const backups = await listBackups();
      const backup = backups.find((b) => b.filename === filename);

      if (!backup) {
        throw new Error("Backup was created but not found in list");
      }

      ok(res, backup);
    } catch (error) {
      logger.error("Failed to create backup", {
        route: "POST /api/backups",
        error,
      });
      throw error;
    }
  }),
);

/**
 * DELETE /api/backups/:filename - Delete a specific backup
 */
backupRouter.delete(
  "/:filename",
  asyncRoute(async (req: Request, res: Response) => {
    try {
      if (isDemoMode()) {
        return sendDemoBlocked(
          res,
          "Deleting backups is disabled in the public demo.",
          {
            route: "DELETE /api/backups/:filename",
            filename: req.params.filename,
          },
        );
      }

      if (await rejectMultiUserInstall(res)) return;

      const { filename } = req.params;

      if (!filename) {
        fail(res, badRequest("Filename is required"));
        return;
      }

      await deleteBackup(filename);
      ok(res, { message: `Backup ${filename} deleted successfully` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      logger.error("Failed to delete backup", {
        route: "DELETE /api/backups/:filename",
        filename: req.params.filename,
        error,
      });

      if (message.includes("not found")) {
        fail(res, notFound(message));
        return;
      }
      if (message.includes("Invalid")) {
        fail(res, badRequest(message));
        return;
      }
      throw error;
    }
  }),
);
