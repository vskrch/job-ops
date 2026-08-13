/**
 * API routes for the user's resume profile.
 *
 * POST   /api/user-profile/resume   — upload a resume PDF (multipart "file"):
 *                                     text extraction → structured profile →
 *                                     base resume conversion; replaces any
 *                                     previous upload
 * GET    /api/user-profile          — get the current uploaded profile
 * GET    /api/user-profile/base-resume — get the profile converted to the
 *                                     base resume (ResumeProfile) format
 * DELETE /api/user-profile          — remove the uploaded profile
 */

import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { badRequest, notFound, toAppError } from "@infra/errors";
import { fail, ok } from "@infra/http";
import { logger } from "@infra/logger";
import * as userProfileRepo from "@server/repositories/user-profile";
import { clearProfileCache } from "@server/services/profile";
import {
  processResumeUpload,
  profileToResumeProfile,
} from "@server/services/resume-parser";
import type { ResumeProfile, UserProfile } from "@shared/types";
import {
  type NextFunction,
  type Request,
  type Response,
  Router,
} from "express";
import multer from "multer";

export const userProfileRouter = Router();

const MAX_RESUME_BYTES = 10 * 1024 * 1024;

// Uploads spool to disk instead of RAM: PDF parsing expands files many times
// over in memory, and on the constrained production container a memory-backed
// upload was enough to push the process past its heap limit.
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename: (_req, file, cb) =>
      cb(
        null,
        `jobops-resume-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase() || ".pdf"}`,
      ),
  }),
  limits: { fileSize: MAX_RESUME_BYTES },
});

/** Runs the multer upload and maps its errors onto the API error contract. */
function uploadResumeSingle(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  upload.single("file")(req, res, (error) => {
    if (error instanceof multer.MulterError) {
      const message =
        error.code === "LIMIT_FILE_SIZE"
          ? "The PDF is too large. Maximum size is 10 MB."
          : `Upload failed: ${error.code}`;
      fail(res, badRequest(message));
      return;
    }
    next(error);
  });
}

type ResumeImportTask = {
  id: string;
  status: "processing" | "done" | "failed";
  createdAt: number;
  profile?: UserProfile;
  baseResume?: ResumeProfile;
  error?: { code: string; message: string };
};

const RESUME_TASK_TTL_MS = 30 * 60_000;
const MAX_RESUME_TASKS = 20;
const resumeImportTasks = new Map<string, ResumeImportTask>();

function pruneResumeTasks(): void {
  const cutoff = Date.now() - RESUME_TASK_TTL_MS;
  for (const [id, task] of resumeImportTasks) {
    if (task.status !== "processing" && task.createdAt < cutoff) {
      resumeImportTasks.delete(id);
    }
  }
  if (resumeImportTasks.size <= MAX_RESUME_TASKS) return;
  const completed = [...resumeImportTasks.values()]
    .filter((task) => task.status !== "processing")
    .sort((a, b) => a.createdAt - b.createdAt);
  for (const task of completed.slice(
    0,
    resumeImportTasks.size - MAX_RESUME_TASKS,
  )) {
    resumeImportTasks.delete(task.id);
  }
}

function startResumeImport(
  taskId: string,
  tempPath: string,
  fileName: string | null,
): void {
  void processResumeUpload(tempPath, fileName)
    .then(({ profile, baseResume }) => {
      const task = resumeImportTasks.get(taskId);
      if (task) {
        task.status = "done";
        task.profile = profile;
        task.baseResume = baseResume;
      }
      // The profile fallback in getProfile() caches conversions; invalidate so
      // scoring/tailoring pick up the new upload immediately.
      clearProfileCache();
      logger.info("Resume profile updated from PDF upload", {
        taskId,
        profileId: profile.id,
        fileName: profile.fileName,
        skills: profile.skills.length,
        experienceEntries: profile.experience.length,
      });
    })
    .catch((error) => {
      const appError = toAppError(error);
      const task = resumeImportTasks.get(taskId);
      if (task) {
        task.status = "failed";
        task.error = { code: appError.code, message: appError.message };
      }
      logger.warn("Resume import failed", {
        taskId,
        code: appError.code,
        message: appError.message,
      });
    })
    .finally(() => {
      fs.unlink(tempPath).catch(() => {});
    });
}

/**
 * POST /api/user-profile/resume — upload a resume PDF and parse it in the
 * background. Returns 202 with a taskId immediately; poll the status endpoint
 * until the import completes. Slow LLM providers would otherwise exceed the
 * platform's 30s router budget for the synchronous request.
 */
userProfileRouter.post(
  "/resume",
  uploadResumeSingle,
  (req: Request, res: Response) => {
    const tempPath = req.file?.path ?? null;
    if (!req.file) {
      return fail(
        res,
        badRequest("No file uploaded. Expected multipart field 'file'."),
      );
    }
    if (req.file.size === 0) {
      if (tempPath) void fs.unlink(tempPath).catch(() => {});
      return fail(res, badRequest("The uploaded PDF is empty"));
    }
    if (!req.file.originalname.toLowerCase().endsWith(".pdf")) {
      if (tempPath) void fs.unlink(tempPath).catch(() => {});
      return fail(res, badRequest("Only PDF files are supported"));
    }

    pruneResumeTasks();
    const taskId = randomUUID();
    resumeImportTasks.set(taskId, {
      id: taskId,
      status: "processing",
      createdAt: Date.now(),
    });
    startResumeImport(
      taskId,
      tempPath as string,
      req.file.originalname || null,
    );
    return ok(res, { taskId, status: "processing" }, 202);
  },
);

/**
 * GET /api/user-profile/resume/status/:taskId — poll a resume import task.
 */
userProfileRouter.get(
  "/resume/status/:taskId",
  (req: Request, res: Response) => {
    const task = resumeImportTasks.get(req.params.taskId);
    if (!task) {
      return fail(res, notFound("Unknown or expired resume import task"));
    }
    if (task.status === "done") {
      return ok(res, {
        status: task.status,
        profile: task.profile,
        baseResume: task.baseResume,
      });
    }
    if (task.status === "failed") {
      return ok(res, { status: task.status, error: task.error });
    }
    return ok(res, { status: task.status });
  },
);

/**
 * GET /api/user-profile — current uploaded profile.
 */
userProfileRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const profile = await userProfileRepo.getCurrentUserProfile();
    if (!profile) {
      return fail(res, notFound("No resume uploaded yet"));
    }
    return ok(res, { profile });
  } catch (error) {
    return fail(res, toAppError(error));
  }
});

/**
 * GET /api/user-profile/base-resume — uploaded profile in base-resume format.
 */
userProfileRouter.get("/base-resume", async (_req: Request, res: Response) => {
  try {
    const profile = await userProfileRepo.getCurrentUserProfile();
    if (!profile) {
      return fail(res, notFound("No resume uploaded yet"));
    }
    return ok(res, { baseResume: profileToResumeProfile(profile) });
  } catch (error) {
    return fail(res, toAppError(error));
  }
});

/**
 * DELETE /api/user-profile — remove the uploaded profile.
 */
userProfileRouter.delete("/", async (_req: Request, res: Response) => {
  try {
    const deleted = await userProfileRepo.deleteCurrentUserProfile();
    if (!deleted) {
      return fail(res, notFound("No resume uploaded yet"));
    }
    clearProfileCache();
    return ok(res, { deleted: true });
  } catch (error) {
    return fail(res, toAppError(error));
  }
});
