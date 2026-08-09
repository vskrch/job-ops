import { AsyncLocalStorage } from "node:async_hooks";

export type RequestContext = {
  requestId: string;
  pipelineRunId?: string;
  jobId?: string;
  /** Job search run id (job-search feature, ADR-002). */
  searchId?: string;
  /** Authenticated user id for this request/flow; "default-user" when anon. */
  userId?: string;
};

const storage = new AsyncLocalStorage<RequestContext>();

export function getRequestContext(): RequestContext | undefined {
  return storage.getStore();
}

export function runWithRequestContext<T>(
  context: Partial<RequestContext>,
  fn: () => T,
): T {
  const current = storage.getStore();
  const merged: RequestContext = {
    requestId: context.requestId ?? current?.requestId ?? "unknown",
    ...(current ?? {}),
    ...context,
  };
  return storage.run(merged, fn);
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/**
 * Returns the authenticated user id for the current request or background
 * flow. Falls back to "default-user" for unauthenticated access and for
 * background work (pipeline runs, backup scheduler) that runs outside a
 * request's async chain — keeping single-user installs working.
 */
export function getCurrentUserId(): string {
  return storage.getStore()?.userId ?? "default-user";
}
