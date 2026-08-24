import { badRequest, notFound } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { getCurrentUserId } from "@infra/request-context";
import { db, schema } from "@server/db/index";
import { and, eq } from "drizzle-orm";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const resumeTemplatesRouter = Router();

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  kind: z.enum(["cv", "cover"]),
  manifest: z.string().trim().min(2).max(20000),
  storagePath: z.string().trim().min(1).max(500),
});

resumeTemplatesRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    const rows = await db
      .select()
      .from(schema.resumeTemplates)
      .where(eq(schema.resumeTemplates.userId, getCurrentUserId()));
    return ok(res, { templates: rows });
  }),
);

resumeTemplatesRouter.post(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const parsed = createSchema.parse(req.body ?? {});
    const { randomUUID } = await import("node:crypto");
    const id = randomUUID();
    await db.insert(schema.resumeTemplates).values({
      id,
      userId: getCurrentUserId(),
      name: parsed.name,
      kind: parsed.kind,
      manifest: parsed.manifest,
      storagePath: parsed.storagePath,
      active: false,
    });
    const [row] = await db
      .select()
      .from(schema.resumeTemplates)
      .where(eq(schema.resumeTemplates.id, id))
      .limit(1);
    return ok(res, { template: row }, 201);
  }),
);

resumeTemplatesRouter.post(
  "/:id/activate",
  asyncRoute(async (req: Request, res: Response) => {
    const id = String(req.params.id ?? "").trim();
    if (!id) return fail(res, badRequest("Template id required"));
    const userId = getCurrentUserId();
    const [row] = await db
      .select()
      .from(schema.resumeTemplates)
      .where(
        and(
          eq(schema.resumeTemplates.id, id),
          eq(schema.resumeTemplates.userId, userId),
        ),
      )
      .limit(1);
    if (!row) return fail(res, notFound("Template not found"));
    // Deactivate all others of the same kind, activate this one.
    await db
      .update(schema.resumeTemplates)
      .set({ active: false, updatedAt: new Date().toISOString() })
      .where(
        and(
          eq(schema.resumeTemplates.userId, userId),
          eq(schema.resumeTemplates.kind, row.kind),
        ),
      );
    await db
      .update(schema.resumeTemplates)
      .set({ active: true, updatedAt: new Date().toISOString() })
      .where(eq(schema.resumeTemplates.id, id));
    const [updated] = await db
      .select()
      .from(schema.resumeTemplates)
      .where(eq(schema.resumeTemplates.id, id))
      .limit(1);
    return ok(res, { template: updated });
  }),
);
