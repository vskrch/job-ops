import { asyncRoute, ok } from "@infra/http";
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
    req.session = req.session || {};
    req.session.userId = user.id;
    ok(res, { user });
  }),
);

authRouter.post(
  "/login",
  asyncRoute(async (req: Request, res: Response) => {
    const { email, password } = req.body || {};
    const user = await authenticateUser({ email, password });
    req.session = req.session || {};
    req.session.userId = user.id;
    ok(res, { user });
  }),
);

authRouter.post(
  "/logout",
  asyncRoute(async (req: Request, res: Response) => {
    if (req.session) {
      req.session.userId = undefined;
    }
    ok(res, { loggedOut: true });
  }),
);

authRouter.get(
  "/me",
  asyncRoute(async (req: Request, res: Response) => {
    const userId = req.session?.userId || req.user?.id;
    if (!userId) {
      ok(res, { user: null });
      return;
    }
    const user = await getUserById(userId);
    ok(res, { user });
  }),
);
