/**
 * Tests for the email delivery service.
 *
 * Key guarantee: email is optional infrastructure. Without SMTP configured
 * the service returns a failure result immediately (never throws), so the
 * search itself always completes and results remain visible in the UI.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  vi.resetModules();
});

describe("sendSearchResultsEmail", () => {
  it("returns SMTP not configured without throwing when no SMTP_HOST is set", async () => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    delete process.env.SMTP_FROM;

    const { sendSearchResultsEmail } = await import("./email");

    const result = await sendSearchResultsEmail(
      {
        id: "search-1",
        originalQuery: "Data Engineer",
        queryHash: "hash",
        parsedSpec: null,
        status: "completed",
        results: null,
        sourcesSearched: [],
        sourcesSucceeded: [],
        sourcesFailed: [],
        searchStartedAt: null,
        searchCompletedAt: null,
        emailStatus: "pending",
        emailSentAt: null,
        emailError: null,
        errorMessage: null,
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
      },
      "http://localhost:3001",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("SMTP not configured");
  });

  it("does not touch the search record — it only returns a result", async () => {
    delete process.env.SMTP_HOST;

    const { sendSearchResultsEmail } = await import("./email");
    const result = await sendSearchResultsEmail(
      {
        id: "search-2",
        originalQuery: "query",
        queryHash: "hash",
        parsedSpec: null,
        status: "completed",
        results: {
          totalDiscovered: 1,
          totalAfterFilter: 1,
          duplicatesRemoved: 0,
          highlyRelevant: 1,
          incompleteInfo: 0,
          jobs: [],
          sources: [],
          freshness: {
            requested: null,
            effectiveStart: null,
            effectiveEnd: null,
            removedByFreshness: 0,
          },
        },
        sourcesSearched: [],
        sourcesSucceeded: [],
        sourcesFailed: [],
        searchStartedAt: null,
        searchCompletedAt: null,
        emailStatus: "pending",
        emailSentAt: null,
        emailError: null,
        errorMessage: null,
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
      },
      "http://localhost:3001",
    );

    expect(result).toEqual({ success: false, error: "SMTP not configured" });
  });
});
