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
  providesSources: [
    "dice",
    "monster",
    "instahyre",
    "eluta",
    "builtin",
    "simplyhired",
    "jobbank",
    "foundit",
    "shine",
    "timesjobs",
    "freshersworld",
    "wellfound",
    "snagajob",
    "roberthalf",
    "flexjobs",
    "arcdev",
    "hired",
    "iimjobs",
    "cutshort",
    "ncs",
    "jobboom",
    "apna",
    "internshala",
  ],
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const maxJobsPerTerm = context.settings.jobspyResultsWanted
      ? parseInt(context.settings.jobspyResultsWanted, 10)
      : 200;

    // UI-managed LLM settings (Settings > Models); env vars stay as the
    // fallback inside the shared client when these are unset.
    const llm = {
      baseUrl: context.settings.llmBaseUrl || undefined,
      apiKey: context.settings.llmApiKey || undefined,
      model: context.settings.model || undefined,
    };

    const result = await runJobBoards({
      sources: context.selectedSources,
      searchTerms: context.searchTerms,
      maxJobsPerTerm,
      llm,
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
