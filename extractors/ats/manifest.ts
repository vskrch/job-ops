import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { type AtsProgressEvent, parseList, runAts } from "./src/run";

function toProgress(event: AtsProgressEvent): ExtractorProgressEvent {
  if (event.type === "run_complete") {
    return {
      phase: "list",
      jobPagesProcessed: event.totalJobs,
      detail: event.detail,
    };
  }

  return {
    phase: "list",
    currentUrl: `${event.source}:${event.board}`,
    detail: event.detail,
  };
}

export const manifest: ExtractorManifest = {
  id: "ats",
  displayName: "ATS (Greenhouse / Lever / Ashby)",
  providesSources: ["greenhouse", "lever", "ashby"],
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const greenhouseBoards = parseList(
      context.settings.greenhouseBoards ?? process.env.GREENHOUSE_BOARDS,
    );
    const leverCompanies = parseList(
      context.settings.leverCompanies ?? process.env.LEVER_COMPANIES,
    );
    const ashbyOrgs = parseList(
      context.settings.ashbyOrgs ?? process.env.ASHBY_ORGS,
    );

    if (
      greenhouseBoards.length === 0 &&
      leverCompanies.length === 0 &&
      ashbyOrgs.length === 0
    ) {
      return { success: true, jobs: [] };
    }

    const result = await runAts({
      greenhouseBoards,
      leverCompanies,
      ashbyOrgs,
      shouldCancel: context.shouldCancel,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
      },
    });

    if (!result.success) {
      return { success: false, jobs: [], error: result.error };
    }

    return { success: true, jobs: result.jobs };
  },
};

export default manifest;
