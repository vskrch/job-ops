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
    req.session.userId = user.id;
    res.json(ok(req, { user }));
  }),
);

authRouter.post(
  "/login",
  asyncRoute(async (req: Request, res: Response) => {
    const { email, password } = req.body || {};
    const user = await authenticateUser({ email, password });
    req.session.userId = user.id;
    res.json(ok(req, { user }));
  }),
);

authRouter.post(
  "/logout",
  asyncRoute(async (req: Request, res: Response) => {
    req.session.userId = undefined;
    res.json(ok(req, { loggedOut: true }));
  }),
);

authRouter.get(
  "/me",
  asyncRoute(async (req: Request, res: Response) => {
    const userId = req.session?.userId || (req.user as { id?: string })?.id;
    if (!userId) {
      res.json(ok(req, { user: null }));
      return;
    }
    const user = await getUserById(userId);
    res.json(ok(req, { user }));
  }),
);
