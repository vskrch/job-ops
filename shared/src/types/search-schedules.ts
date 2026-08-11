/**
 * Periodic search scanning schedule types.
 *
 * A search schedule represents a recurring natural-language job search that
 * runs on a configurable schedule (hourly or daily) and sends notifications
 * (email, webhook, Telegram) when new jobs are found.
 */

export type SearchScheduleFrequency = "hourly" | "daily";

export interface SearchSchedule {
  id: string;
  label: string;
  enabled: boolean;
  frequency: SearchScheduleFrequency;
  /** Hour of day (0-23 UTC) for daily schedules. Null for hourly schedules. */
  hour: number | null;
  /** Minute offset (0-59) for hourly schedules. Defaults to 0. */
  minute: number;
  /** The natural-language search query. */
  query: string;
  notifyEmail: boolean;
  notifyWebhook: boolean;
  /** ISO timestamp of the last run, or null if never run. */
  lastRunAt: string | null;
  /** ID of the job_searches row from the last run, or null. */
  lastSearchId: string | null;
  /** Number of results from the last run, or null. */
  lastResultsCount: number | null;
  createdAt: string;
  updatedAt: string;
  /** Computed next-run ISO timestamp (from the active scheduler), or null. */
  nextRun: string | null;
}

export interface CreateSearchScheduleInput {
  label: string;
  enabled?: boolean;
  frequency?: SearchScheduleFrequency;
  /** Hour (0-23) for daily. Omit/nullable for hourly. */
  hour?: number | null;
  /** Minute offset (0-59) for hourly. Defaults to 0. */
  minute?: number;
  query: string;
  notifyEmail?: boolean;
  notifyWebhook?: boolean;
}

export type UpdateSearchScheduleInput = Partial<CreateSearchScheduleInput>;

/** Response from the manual "run now" endpoint. */
export interface RunSearchScheduleResponse {
  searchId: string;
  status: string;
  resultsCount: number | null;
}
