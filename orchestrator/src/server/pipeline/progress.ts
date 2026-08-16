import { logger } from "@infra/logger";
import { getCurrentUserId } from "@infra/request-context";

/**
 * Multi-tenant pipeline progress tracking with Server-Sent Events.
 * State, replay buffers, and listeners are partitioned per-user so
 * each user's pipeline run and status are fully isolated.
 */

export type PipelineStep =
  | "idle"
  | "crawling"
  | "importing"
  | "scoring"
  | "processing"
  | "completed"
  | "cancelled"
  | "failed";

export type CrawlSource = string;

export interface PipelineProgress {
  step: PipelineStep;
  message: string;
  detail?: string;
  crawlingSource: CrawlSource | null;
  crawlingSourcesCompleted: number;
  crawlingSourcesTotal: number;
  crawlingTermsProcessed: number;
  crawlingTermsTotal: number;
  crawlingListPagesProcessed: number;
  crawlingListPagesTotal: number;
  crawlingJobCardsFound: number;
  crawlingJobPagesEnqueued: number;
  crawlingJobPagesSkipped: number;
  crawlingJobPagesProcessed: number;
  crawlingPhase?: "list" | "job";
  crawlingCurrentUrl?: string;
  jobsDiscovered: number;
  jobsScored: number;
  jobsProcessed: number;
  totalToProcess: number;
  currentJob?: {
    id: string;
    title: string;
    employer: string;
  };
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

type ProgressListener = (progress: PipelineProgress) => void;

const MAX_REPLAY_EVENTS = 100;

function createIdleProgress(): PipelineProgress {
  return {
    step: "idle",
    message: "Ready",
    crawlingSource: null,
    crawlingSourcesCompleted: 0,
    crawlingSourcesTotal: 0,
    crawlingTermsProcessed: 0,
    crawlingTermsTotal: 0,
    crawlingListPagesProcessed: 0,
    crawlingListPagesTotal: 0,
    crawlingJobCardsFound: 0,
    crawlingJobPagesEnqueued: 0,
    crawlingJobPagesSkipped: 0,
    crawlingJobPagesProcessed: 0,
    jobsDiscovered: 0,
    jobsScored: 0,
    jobsProcessed: 0,
    totalToProcess: 0,
  };
}

const emptyCrawlingStats = {
  crawlingTermsProcessed: 0,
  crawlingTermsTotal: 0,
  crawlingListPagesProcessed: 0,
  crawlingListPagesTotal: 0,
  crawlingJobCardsFound: 0,
  crawlingJobPagesEnqueued: 0,
  crawlingJobPagesSkipped: 0,
  crawlingJobPagesProcessed: 0,
  crawlingPhase: undefined,
  crawlingCurrentUrl: undefined,
};

type SourceCrawlingStats = {
  termsProcessed: number;
  termsTotal: number;
  listPagesProcessed: number;
  listPagesTotal: number;
  jobCardsFound: number;
  jobPagesEnqueued: number;
  jobPagesSkipped: number;
  jobPagesProcessed: number;
};

const emptySourceCrawlingStats = (): SourceCrawlingStats => ({
  termsProcessed: 0,
  termsTotal: 0,
  listPagesProcessed: 0,
  listPagesTotal: 0,
  jobCardsFound: 0,
  jobPagesEnqueued: 0,
  jobPagesSkipped: 0,
  jobPagesProcessed: 0,
});

// Per-user state storage
const userProgressMap = new Map<string, PipelineProgress>();
const userListenersMap = new Map<string, Set<ProgressListener>>();
const userReplayBufferMap = new Map<string, PipelineProgress[]>();
const userCrawlingStatsMap = new Map<
  string,
  Map<CrawlSource, SourceCrawlingStats>
>();

function resolveUserId(explicitUserId?: string): string {
  return explicitUserId || getCurrentUserId();
}

function getUserCrawlingStats(
  userId: string,
): Map<CrawlSource, SourceCrawlingStats> {
  let stats = userCrawlingStatsMap.get(userId);
  if (!stats) {
    stats = new Map<CrawlSource, SourceCrawlingStats>();
    userCrawlingStatsMap.set(userId, stats);
  }
  return stats;
}

function aggregateCrawlingStats(userId: string) {
  const crawlingStatsBySource = getUserCrawlingStats(userId);
  let termsProcessed = 0;
  let termsTotal = 0;
  let listPagesProcessed = 0;
  let listPagesTotal = 0;
  let jobCardsFound = 0;
  let jobPagesEnqueued = 0;
  let jobPagesSkipped = 0;
  let jobPagesProcessed = 0;

  for (const stats of crawlingStatsBySource.values()) {
    termsProcessed += stats.termsProcessed;
    termsTotal += stats.termsTotal;
    listPagesProcessed += stats.listPagesProcessed;
    listPagesTotal += stats.listPagesTotal;
    jobCardsFound += stats.jobCardsFound;
    jobPagesEnqueued += stats.jobPagesEnqueued;
    jobPagesSkipped += stats.jobPagesSkipped;
    jobPagesProcessed += stats.jobPagesProcessed;
  }

  return {
    termsProcessed,
    termsTotal,
    listPagesProcessed,
    listPagesTotal,
    jobCardsFound,
    jobPagesEnqueued,
    jobPagesSkipped,
    jobPagesProcessed,
  };
}

/**
 * Update the current progress and notify all listeners for the user.
 * Each update is pushed to a bounded replay buffer so reconnecting
 * clients can catch up on missed events.
 */
export function updateProgress(
  update: Partial<PipelineProgress>,
  explicitUserId?: string,
): void {
  const userId = resolveUserId(explicitUserId);
  const current = userProgressMap.get(userId) ?? createIdleProgress();
  const next = { ...current, ...update };
  userProgressMap.set(userId, next);

  let replayBuffer = userReplayBufferMap.get(userId);
  if (!replayBuffer) {
    replayBuffer = [];
    userReplayBufferMap.set(userId, replayBuffer);
  }
  replayBuffer.push({ ...next });
  if (replayBuffer.length > MAX_REPLAY_EVENTS) {
    replayBuffer.splice(0, replayBuffer.length - MAX_REPLAY_EVENTS);
  }

  // Notify all listeners for this user
  const listeners = userListenersMap.get(userId);
  if (listeners) {
    for (const listener of listeners) {
      try {
        listener(next);
      } catch (error) {
        logger.error("Error in progress listener", error);
      }
    }
  }
}

/**
 * Get the current progress state for a user.
 */
export function getProgress(explicitUserId?: string): PipelineProgress {
  const userId = resolveUserId(explicitUserId);
  return { ...(userProgressMap.get(userId) ?? createIdleProgress()) };
}

/**
 * Subscribe to progress updates for a user.
 * Replays buffered events in order so late subscribers (e.g. a user
 * reopening the page mid-run) can reconstruct missed state.
 */
export function subscribeToProgress(
  listener: ProgressListener,
  explicitUserId?: string,
): () => void {
  const userId = resolveUserId(explicitUserId);
  let listeners = userListenersMap.get(userId);
  if (!listeners) {
    listeners = new Set<ProgressListener>();
    userListenersMap.set(userId, listeners);
  }
  listeners.add(listener);

  // Replay buffered events in order so late subscribers reconstruct state.
  const replayBuffer = userReplayBufferMap.get(userId) ?? [];
  for (const event of replayBuffer) {
    try {
      listener(event);
    } catch (error) {
      logger.error("Error replaying progress to listener", error);
    }
  }

  // Return unsubscribe function
  return () => {
    listeners?.delete(listener);
    if (listeners && listeners.size === 0) {
      userListenersMap.delete(userId);
    }
  };
}

/**
 * Reset progress to idle state and clear the replay buffer for a user.
 */
export function resetProgress(explicitUserId?: string): void {
  const userId = resolveUserId(explicitUserId);
  userCrawlingStatsMap.delete(userId);
  userReplayBufferMap.delete(userId);
  userProgressMap.set(userId, createIdleProgress());
}

/**
 * Clear all multi-tenant progress state for test isolation.
 */
export function __resetProgressForTests(): void {
  userProgressMap.clear();
  userListenersMap.clear();
  userReplayBufferMap.clear();
  userCrawlingStatsMap.clear();
}

/**
 * Helper to create progress updates for each step.
 */
export const progressHelpers = {
  startCrawling: (sourcesTotal = 0, explicitUserId?: string) => {
    const userId = resolveUserId(explicitUserId);
    const crawlingStatsBySource = getUserCrawlingStats(userId);
    crawlingStatsBySource.clear();
    updateProgress(
      {
        step: "crawling",
        message: "Fetching jobs from sources...",
        detail: "Starting crawler",
        startedAt: new Date().toISOString(),
        crawlingSource: null,
        crawlingSourcesCompleted: 0,
        crawlingSourcesTotal: sourcesTotal,
        ...emptyCrawlingStats,
        jobsDiscovered: 0,
        jobsScored: 0,
        jobsProcessed: 0,
        totalToProcess: 0,
      },
      userId,
    );
  },

  startSource: (
    source: CrawlSource,
    sourcesCompleted: number,
    sourcesTotal: number,
    options?: { termsTotal?: number; detail?: string },
    explicitUserId?: string,
  ) => {
    const userId = resolveUserId(explicitUserId);
    const crawlingStatsBySource = getUserCrawlingStats(userId);
    const existing =
      crawlingStatsBySource.get(source) ?? emptySourceCrawlingStats();
    crawlingStatsBySource.set(source, {
      ...emptySourceCrawlingStats(),
      termsTotal: options?.termsTotal ?? existing.termsTotal,
    });
    const aggregated = aggregateCrawlingStats(userId);

    updateProgress(
      {
        step: "crawling",
        message: `Fetching jobs from ${source}...`,
        detail: options?.detail,
        crawlingSource: source,
        crawlingSourcesCompleted: sourcesCompleted,
        crawlingSourcesTotal: sourcesTotal,
        crawlingTermsProcessed: aggregated.termsProcessed,
        crawlingTermsTotal: aggregated.termsTotal,
        crawlingListPagesProcessed: aggregated.listPagesProcessed,
        crawlingListPagesTotal: aggregated.listPagesTotal,
        crawlingJobCardsFound: aggregated.jobCardsFound,
        crawlingJobPagesEnqueued: aggregated.jobPagesEnqueued,
        crawlingJobPagesSkipped: aggregated.jobPagesSkipped,
        crawlingJobPagesProcessed: aggregated.jobPagesProcessed,
        crawlingPhase: undefined,
        crawlingCurrentUrl: undefined,
      },
      userId,
    );
  },

  completeSource: (
    sourcesCompleted: number,
    sourcesTotal: number,
    explicitUserId?: string,
  ) =>
    updateProgress(
      {
        crawlingSourcesCompleted: sourcesCompleted,
        crawlingSourcesTotal: sourcesTotal,
        crawlingCurrentUrl: undefined,
        crawlingPhase: undefined,
      },
      explicitUserId,
    ),

  crawlingUpdate: (
    update: {
      source?: CrawlSource;
      termsProcessed?: number;
      termsTotal?: number;
      listPagesProcessed?: number;
      listPagesTotal?: number;
      jobCardsFound?: number;
      jobPagesEnqueued?: number;
      jobPagesSkipped?: number;
      jobPagesProcessed?: number;
      phase?: "list" | "job";
      currentUrl?: string;
    },
    explicitUserId?: string,
  ) => {
    const userId = resolveUserId(explicitUserId);
    const crawlingStatsBySource = getUserCrawlingStats(userId);
    const current = getProgress(userId);
    if (update.source) {
      const existing =
        crawlingStatsBySource.get(update.source) ?? emptySourceCrawlingStats();
      const nextForSource: SourceCrawlingStats = {
        termsProcessed: update.termsProcessed ?? existing.termsProcessed,
        termsTotal: update.termsTotal ?? existing.termsTotal,
        listPagesProcessed:
          update.listPagesProcessed ?? existing.listPagesProcessed,
        listPagesTotal: update.listPagesTotal ?? existing.listPagesTotal,
        jobCardsFound: update.jobCardsFound ?? existing.jobCardsFound,
        jobPagesEnqueued: update.jobPagesEnqueued ?? existing.jobPagesEnqueued,
        jobPagesSkipped: update.jobPagesSkipped ?? existing.jobPagesSkipped,
        jobPagesProcessed:
          update.jobPagesProcessed ?? existing.jobPagesProcessed,
      };
      crawlingStatsBySource.set(update.source, nextForSource);
    }

    const aggregated = aggregateCrawlingStats(userId);
    const next = {
      ...current,
      crawlingSource: update.source ?? current.crawlingSource,
      crawlingTermsProcessed: update.source
        ? aggregated.termsProcessed
        : (update.termsProcessed ?? current.crawlingTermsProcessed),
      crawlingTermsTotal: update.source
        ? aggregated.termsTotal
        : (update.termsTotal ?? current.crawlingTermsTotal),
      crawlingListPagesProcessed: update.source
        ? aggregated.listPagesProcessed
        : (update.listPagesProcessed ?? current.crawlingListPagesProcessed),
      crawlingListPagesTotal: update.source
        ? aggregated.listPagesTotal
        : (update.listPagesTotal ?? current.crawlingListPagesTotal),
      crawlingJobCardsFound: update.source
        ? aggregated.jobCardsFound
        : (update.jobCardsFound ?? current.crawlingJobCardsFound),
      crawlingJobPagesEnqueued: update.source
        ? aggregated.jobPagesEnqueued
        : (update.jobPagesEnqueued ?? current.crawlingJobPagesEnqueued),
      crawlingJobPagesSkipped: update.source
        ? aggregated.jobPagesSkipped
        : (update.jobPagesSkipped ?? current.crawlingJobPagesSkipped),
      crawlingJobPagesProcessed: update.source
        ? aggregated.jobPagesProcessed
        : (update.jobPagesProcessed ?? current.crawlingJobPagesProcessed),
      crawlingPhase: update.phase ?? current.crawlingPhase,
      crawlingCurrentUrl: update.currentUrl ?? current.crawlingCurrentUrl,
    };

    const sourcesPart =
      next.crawlingListPagesTotal > 0
        ? `${next.crawlingListPagesProcessed}/${next.crawlingListPagesTotal}`
        : `${next.crawlingListPagesProcessed}`;

    const pagesPart = `${next.crawlingJobPagesProcessed}/${next.crawlingJobPagesEnqueued}`;
    const termsPart =
      next.crawlingTermsTotal > 0
        ? `, terms ${next.crawlingTermsProcessed}/${next.crawlingTermsTotal}`
        : "";
    const skippedPart =
      next.crawlingJobPagesSkipped > 0
        ? `, skipped ${next.crawlingJobPagesSkipped}`
        : "";
    const cardsPart =
      next.crawlingJobCardsFound > 0
        ? `, cards ${next.crawlingJobCardsFound}`
        : "";

    const message = `Crawling jobs (list pages ${sourcesPart}, job pages ${pagesPart}${termsPart}${skippedPart}${cardsPart})...`;
    const detail =
      next.crawlingCurrentUrl && next.crawlingPhase
        ? `${next.crawlingPhase === "list" ? "List" : "Job"}: ${next.crawlingCurrentUrl}`
        : next.crawlingCurrentUrl
          ? next.crawlingCurrentUrl
          : "Running crawler";

    updateProgress(
      {
        step: "crawling",
        message,
        detail,
        crawlingSource: next.crawlingSource,
        crawlingTermsProcessed: next.crawlingTermsProcessed,
        crawlingTermsTotal: next.crawlingTermsTotal,
        crawlingListPagesProcessed: next.crawlingListPagesProcessed,
        crawlingListPagesTotal: next.crawlingListPagesTotal,
        crawlingJobCardsFound: next.crawlingJobCardsFound,
        crawlingJobPagesEnqueued: next.crawlingJobPagesEnqueued,
        crawlingJobPagesSkipped: next.crawlingJobPagesSkipped,
        crawlingJobPagesProcessed: next.crawlingJobPagesProcessed,
        crawlingPhase: next.crawlingPhase,
        crawlingCurrentUrl: next.crawlingCurrentUrl,
      },
      userId,
    );
  },

  crawlingComplete: (jobsFound: number, explicitUserId?: string) =>
    updateProgress(
      {
        step: "importing",
        message: `Found ${jobsFound} jobs, importing to database...`,
        detail: "Deduplicating and saving",
        jobsDiscovered: jobsFound,
        crawlingSource: null,
        crawlingCurrentUrl: undefined,
      },
      explicitUserId,
    ),

  importComplete: (created: number, skipped: number, explicitUserId?: string) =>
    updateProgress(
      {
        step: "scoring",
        message: `Imported ${created} new jobs (${skipped} duplicates). Scoring...`,
        detail: "Using AI to evaluate job fit",
      },
      explicitUserId,
    ),

  scoringJob: (
    index: number,
    total: number,
    title: string,
    explicitUserId?: string,
  ) =>
    updateProgress(
      {
        step: "scoring",
        message: `Scoring jobs (${index}/${total})...`,
        detail: title,
        jobsScored: index,
      },
      explicitUserId,
    ),

  scoringComplete: (totalScored: number, explicitUserId?: string) =>
    updateProgress(
      {
        step: "scoring",
        message: `Scored ${totalScored} jobs.`,
        detail: "Ready for manual processing",
        jobsScored: totalScored,
        totalToProcess: 0,
        jobsProcessed: 0,
        currentJob: undefined,
      },
      explicitUserId,
    ),

  processingJob: (
    index: number,
    total: number,
    job: { id: string; title: string; employer: string },
    explicitUserId?: string,
  ) =>
    updateProgress(
      {
        step: "processing",
        message: `Processing job ${index}/${total}...`,
        detail: `${job.title} @ ${job.employer}`,
        totalToProcess: total,
        currentJob: job,
      },
      explicitUserId,
    ),

  generatingSummary: (
    job: { title: string; employer: string },
    explicitUserId?: string,
  ) =>
    updateProgress(
      {
        detail: `Generating summary for ${job.title}...`,
      },
      explicitUserId,
    ),

  generatingPdf: (
    job: { title: string; employer: string },
    explicitUserId?: string,
  ) =>
    updateProgress(
      {
        detail: `Generating PDF for ${job.title}...`,
      },
      explicitUserId,
    ),

  jobComplete: (index: number, total: number, explicitUserId?: string) =>
    updateProgress(
      {
        jobsProcessed: index,
        detail: `Completed ${index}/${total} jobs`,
      },
      explicitUserId,
    ),

  complete: (discovered: number, processed: number, explicitUserId?: string) =>
    updateProgress(
      {
        step: "completed",
        message: `Pipeline complete! Discovered ${discovered} jobs, processed ${processed}.`,
        detail: "Ready for review",
        completedAt: new Date().toISOString(),
        currentJob: undefined,
      },
      explicitUserId,
    ),

  cancelled: (reason: string, explicitUserId?: string) =>
    updateProgress(
      {
        step: "cancelled",
        message: "Pipeline cancelled",
        detail: reason,
        completedAt: new Date().toISOString(),
        currentJob: undefined,
      },
      explicitUserId,
    ),

  failed: (error: string, explicitUserId?: string) =>
    updateProgress(
      {
        step: "failed",
        message: "Pipeline failed",
        detail: error,
        error,
        completedAt: new Date().toISOString(),
      },
      explicitUserId,
    ),
};
