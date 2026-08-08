/**
 * Strip the appended "(requestId: ...)" suffix from ApiClientError messages so
 * they can be rendered as persistent UI copy without leaking correlation ids.
 * Toasts and logs keep the full message via error.requestId / error.message.
 */
export function userFacingError(error: unknown): string | null {
  if (!(error instanceof Error) || !error.message) return null;
  return error.message.replace(/\s*\(requestId: [^)]+\)$/, "");
}
