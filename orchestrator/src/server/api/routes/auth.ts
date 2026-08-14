import { badRequest, unauthorized } from "@infra/errors";
import { asyncRoute, ok } from "@infra/http";
import { getCurrentUserId } from "@infra/request-context";
import {
  createSessionToken,
  sessionClearCookieHeader,
  sessionSetCookieHeader,
} from "@infra/session";
import {
  authenticateUser,
  changeUserPassword,
  createPasswordResetToken,
  createUser,
  getUserById,
  getUserStats,
  resetPasswordWithToken,
  updateUserProfile,
  verifyPasswordResetToken,
} from "@server/services/auth";
import { type Request, type Response, Router } from "express";

export const authRouter = Router();

authRouter.post(
  "/register",
  asyncRoute(async (req: Request, res: Response) => {
    const { email, password, name } = req.body || {};
    const user = await createUser({ email, password, name });
    res.setHeader(
      "Set-Cookie",
      sessionSetCookieHeader(createSessionToken(user.id)),
    );
    ok(res, { user });
  }),
);

authRouter.post(
  "/login",
  asyncRoute(async (req: Request, res: Response) => {
    const { email, password } = req.body || {};
    const user = await authenticateUser({ email, password });
    res.setHeader(
      "Set-Cookie",
      sessionSetCookieHeader(createSessionToken(user.id)),
    );
    ok(res, { user });
  }),
);

authRouter.post(
  "/logout",
  asyncRoute(async (_req: Request, res: Response) => {
    res.setHeader("Set-Cookie", sessionClearCookieHeader());
    ok(res, { loggedOut: true });
  }),
);

authRouter.get(
  "/me",
  asyncRoute(async (_req: Request, res: Response) => {
    // userId is loaded from the signed-cookie session by the request-context
    // middleware and stored in AsyncLocalStorage.
    const userId = getCurrentUserId();
    if (userId === "default-user") {
      ok(res, { user: null });
      return;
    }
    const user = await getUserById(userId);
    ok(res, { user });
  }),
);

authRouter.post(
  "/forgot-password",
  asyncRoute(async (req: Request, res: Response) => {
    const { email } = req.body || {};
    const origin = req.get("origin") || req.get("referer");
    const result = await createPasswordResetToken({ email, origin });
    ok(res, {
      message:
        "If an account with that email exists, password reset instructions have been generated.",
      emailSent: result.emailSent,
      devToken: result.devToken,
      resetUrl: result.resetUrl,
    });
  }),
);

authRouter.post(
  "/verify-reset-token",
  asyncRoute(async (req: Request, res: Response) => {
    const { token } = req.body || {};
    const result = await verifyPasswordResetToken(token);
    if (!result.valid) {
      throw badRequest(result.error || "Invalid or expired reset token.");
    }
    ok(res, { valid: true, email: result.email });
  }),
);

authRouter.post(
  "/reset-password",
  asyncRoute(async (req: Request, res: Response) => {
    const { token, newPassword } = req.body || {};
    await resetPasswordWithToken({ token, newPassword });
    ok(res, {
      message:
        "Password reset successful. You may now log in with your new password.",
    });
  }),
);

authRouter.patch(
  "/profile",
  asyncRoute(async (req: Request, res: Response) => {
    const userId = getCurrentUserId();
    if (userId === "default-user") {
      throw unauthorized("You must be logged in to update your profile.");
    }
    const { name, email } = req.body || {};
    const user = await updateUserProfile(userId, { name, email });
    ok(res, { user });
  }),
);

authRouter.post(
  "/change-password",
  asyncRoute(async (req: Request, res: Response) => {
    const userId = getCurrentUserId();
    if (userId === "default-user") {
      throw unauthorized("You must be logged in to change your password.");
    }
    const { currentPassword, newPassword } = req.body || {};
    await changeUserPassword(userId, { currentPassword, newPassword });
    ok(res, { message: "Password changed successfully." });
  }),
);

authRouter.get(
  "/stats",
  asyncRoute(async (_req: Request, res: Response) => {
    const userId = getCurrentUserId();
    const stats = await getUserStats(userId);
    ok(res, { stats, isAnonymous: userId === "default-user" });
  }),
);
