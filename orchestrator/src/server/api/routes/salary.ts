import { badRequest, notFound } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import { getSetting } from "@server/repositories/settings";
import {
  lookupCompany,
  validateSalaryDataset,
} from "@server/services/salary-benchmark";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const salaryRouter = Router();

salaryRouter.get(
  "/lookup",
  asyncRoute(async (req: Request, res: Response) => {
    const qs = z
      .object({
        company: z.string().trim().min(1),
        city: z.string().trim().max(120).nullable().optional(),
      })
      .parse({
        company: String(req.query.company ?? ""),
        city: req.query.city ?? null,
      });
    const raw = await getSetting("salaryBenchmarksJson").catch(() => null);
    if (!raw)
      return fail(
        res,
        notFound(
          "No salary dataset configured (settings → salaryBenchmarksJson).",
        ),
      );
    let dataset: unknown;
    try {
      dataset = JSON.parse(raw);
    } catch {
      return fail(
        res,
        badRequest("Configured salary dataset is not valid JSON."),
      );
    }
    const v = validateSalaryDataset(dataset);
    if (!v.ok) return fail(res, badRequest(v.error));
    const hit = lookupCompany(v.dataset, qs.company, qs.city as string | null);
    if (!hit)
      return fail(
        res,
        notFound("Company not found in the configured dataset."),
      );
    return ok(res, { entry: hit, metadata: v.dataset.metadata });
  }),
);
