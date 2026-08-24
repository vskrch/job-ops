import { badRequest, notFound } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import * as companyResearchService from "@server/services/company-research";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const companyResearchRouter = Router();

companyResearchRouter.get(
  "/:company",
  asyncRoute(async (req: Request, res: Response) => {
    const company = String(req.params.company ?? "").trim();
    if (!company) return fail(res, badRequest("Company name is required"));
    const allowStale = req.query.allowStale === "true";
    const result = await companyResearchService.getCompanyResearch(company, {
      allowStale,
    });
    if (!result.payload)
      return fail(
        res,
        notFound("No cached research for this company. POST to fetch."),
      );
    return ok(res, {
      research: result.payload,
      fromCache: result.fromCache,
      fresh: result.fresh,
    });
  }),
);

const refreshSchema = z.object({
  company: z.string().trim().min(1).max(200).optional(),
});

companyResearchRouter.post(
  "/:company/refresh",
  asyncRoute(async (req: Request, res: Response) => {
    const company = String(req.params.company ?? "").trim();
    if (!company) return fail(res, badRequest("Company name is required"));
    refreshSchema.parse({ company });
    const payload =
      await companyResearchService.refreshCompanyResearch(company);
    return ok(res, { research: payload, fromCache: false, fresh: true });
  }),
);
