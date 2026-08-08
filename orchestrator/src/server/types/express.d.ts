import type { UserProfile } from "../services/auth";

declare global {
  namespace Express {
    interface Request {
      user?: UserProfile | null;
      session?: {
        userId?: string;
      };
    }
  }
}
