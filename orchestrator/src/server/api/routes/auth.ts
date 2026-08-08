import { asyncRoute, ok } from "@infra/http";
import { getCurrentUserId } from "@infra/request-context";
import {
  createSessionToken,
  sessionClearCookieHeader,
  sessionSetCookieHeader,
} from "@infra/session";
import {
  authenticateUser,
  createUser,
  getUserById,
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
