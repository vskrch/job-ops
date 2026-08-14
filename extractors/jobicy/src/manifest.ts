import type {
  ExtractorManifest,
  ExtractorProgressEvent,
} from "@shared/types/extractors";
import type { JobicyProgressEvent } from "./run";
import { runJobicy } from "./run";

function toProgress(event: JobicyProgressEvent): ExtractorProgressEvent {
  if (event.type === "term_start") {
    return {
      phase: "list",
      termsProcessed: Math.max(event.termIndex - 1, 0),
      termsTotal: event.termTotal,
      currentUrl: event.searchTerm,
      detail: `Jobicy: term ${event.termIndex}/${event.termTotal} (${event.searchTerm})`,
    };
  }
  return {
    phase: "list",
    termsProcessed: event.termIndex,
    termsTotal: event.termTotal,
    currentUrl: event.searchTerm,
    jobPagesEnqueued: event.jobsFoundTerm ?? 0,
    jobPagesProcessed: event.jobsFoundTerm ?? 0,
    detail: `Jobicy: completed ${event.termIndex}/${event.termTotal} (${event.searchTerm}) with ${event.jobsFoundTerm ?? 0} jobs`,
  };
}

export const manifest: ExtractorManifest = {
  id: "jobicy",
  displayName: "Jobicy",
  providesSources: ["jobicy"],
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

    const result = await runJobicy({
      selectedCountry: context.selectedCountry,
      searchTerms: context.searchTerms,
      maxJobsPerTerm,
      onProgress: (event) => {
        if (context.shouldCancel?.()) return;
        context.onProgress?.(toProgress(event));
      },
      shouldCancel: context.shouldCancel,
    });

    if (!result.success) {
      return {
        success: false,
        jobs: [],
        error: result.error ?? "Jobicy crawl failed",
      };
    }

    return {
      success: true,
      jobs: result.jobs,
    };
  },
};
