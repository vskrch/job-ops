import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import type { JobBoardsProgressEvent } from "./src/run";
import { runJobBoards } from "./src/run";

function toProgress(event: JobBoardsProgressEvent): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Job board: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }
  if (event.type === "page_fetched") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      listPagesProcessed: event.pageNo,
      jobPagesEnqueued: event.totalCollected,
      currentUrl: event.searchTerm,
      detail: `Job board: term ${event.termIndex}/${event.termTotal}, page ${event.pageNo} (${event.totalCollected} collected)`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    detail: `Job board: completed term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
  };
}

export const manifest: ExtractorManifest = {
  id: "jobboards",
  displayName: "Job Boards",
  providesSources: ["dice", "monster", "instahyre", "eluta"],
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const maxJobsPerTerm = context.settings.jobspyResultsWanted
      ? parseInt(context.settings.jobspyResultsWanted, 10)
      : 200;

    const result = await runJobBoards({
      sources: context.selectedSources,
      searchTerms: context.searchTerms,
      maxJobsPerTerm,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
      },
      shouldCancel: context.shouldCancel,
    });

    return result;
  },
};

export default manifest;
