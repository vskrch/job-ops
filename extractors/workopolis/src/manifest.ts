import { createCrawledFetch } from "@shared/crawl/crawled-fetch.js";
import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import { runWorkopolis } from "./run";

function toProgress(event: {
  type: string;
  termIndex: number;
  termTotal: number;
  searchTerm: string;
  jobsFoundTerm?: number;
}): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Workopolis: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    jobPagesEnqueued: event.jobsFoundTerm ?? 0,
    jobPagesProcessed: event.jobsFoundTerm ?? 0,
    detail: `Workopolis: completed ${event.termIndex}/${event.termTotal} (${event.searchTerm}) with ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "workopolis",
  displayName: "Workopolis",
  providesSources: ["workopolis"],
  async run(context) {
    if (context.shouldCancel?.()) {
      return { success: true, jobs: [] };
    }

    const parsedMax = context.settings.jobspyResultsWanted
      ? Number.parseInt(context.settings.jobspyResultsWanted, 10)
      : Number.NaN;
    const maxJobsPerTerm = Number.isFinite(parsedMax)
      ? Math.max(1, parsedMax)
      : 50;

    const result = await runWorkopolis({
      selectedCountry: context.selectedCountry,
      searchTerms: context.searchTerms,
      maxJobsPerTerm,
      fetchImpl: createCrawledFetch({
        source: "workopolis",
        shouldCancel: context.shouldCancel,
      }),
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
      },
      shouldCancel: context.shouldCancel,
    });

    if (!result.success) {
      return { success: false, jobs: [], error: result.error };
    }
    return { success: true, jobs: result.jobs };
  },
};

export default manifest;
