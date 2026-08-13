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
import { type Request, type Response, Router } from "express";
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

/**
 * POST /api/user-profile/resume — upload and parse a resume PDF.
 */
userProfileRouter.post(
  "/resume",
  upload.single("file"),
  async (req: Request, res: Response) => {
    const tempPath = req.file?.path ?? null;
    try {
      if (!req.file) {
        return fail(
          res,
          badRequest("No file uploaded. Expected multipart field 'file'."),
        );
      }
      if (req.file.size === 0) {
        return fail(res, badRequest("The uploaded PDF is empty"));
      }
      if (!req.file.originalname.toLowerCase().endsWith(".pdf")) {
        return fail(res, badRequest("Only PDF files are supported"));
      }

      const { profile, baseResume } = await processResumeUpload(
        tempPath as string,
        req.file.originalname || null,
      );
      // The profile fallback in getProfile() caches conversions; invalidate so
      // scoring/tailoring pick up the new upload immediately.
      clearProfileCache();
      logger.info("Resume profile updated from PDF upload", {
        profileId: profile.id,
        fileName: profile.fileName,
        skills: profile.skills.length,
        experienceEntries: profile.experience.length,
      });
      return ok(res, { profile, baseResume }, 201);
    } catch (error) {
      return fail(res, toAppError(error));
    } finally {
      if (tempPath) {
        fs.unlink(tempPath).catch(() => {});
      }
    }
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
