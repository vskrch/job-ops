import type { Server } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, stopServer } from "./test-utils";

describe.sequential("Pipeline API routes", () => {
  let server: Server;
  let baseUrl: string;
  let closeDb: () => void;
  let tempDir: string;

  beforeEach(async () => {
    ({ server, baseUrl, closeDb, tempDir } = await startServer());
  });

  afterEach(async () => {
    await stopServer({ server, closeDb, tempDir });
  });

  it("reports pipeline status", async () => {
    const res = await fetch(`${baseUrl}/api/pipeline/status`);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.isRunning).toBe(false);
    expect(body.data.activeRunCount).toBe(0);
    expect(body.data.maxConcurrentRuns).toBe(3);
    expect(body.data.lastRun).toBeNull();
    expect(body.data.nextScheduledRun).toBeNull();
  });

  it("reads and manages pipeline schedules", async () => {
    // Initial: no schedules
    const getRes = await fetch(`${baseUrl}/api/pipeline/schedules`);
    const getBody = await getRes.json();
    expect(getBody.ok).toBe(true);
    expect(getBody.data).toEqual([]);

    // Create a schedule
    const createRes = await fetch(`${baseUrl}/api/pipeline/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Morning scan",
        enabled: true,
        hour: 22,
        sources: ["linkedin"],
      }),
    });
    const createBody = await createRes.json();
    expect(createBody.ok).toBe(true);
    expect(createBody.data).toHaveLength(1);
    expect(createBody.data[0].label).toBe("Morning scan");
    expect(createBody.data[0].enabled).toBe(true);
    expect(createBody.data[0].hour).toBe(22);
    expect(createBody.data[0].sources).toEqual(["linkedin"]);
    expect(createBody.data[0].nextRun).not.toBeNull();

    const scheduleId = createBody.data[0].id;

    // Status now reports the scheduled run
    const statusRes = await fetch(`${baseUrl}/api/pipeline/status`);
    const statusBody = await statusRes.json();
    expect(statusBody.data.nextScheduledRun).not.toBeNull();

    // Update the schedule (disable)
    const updateRes = await fetch(
      `${baseUrl}/api/pipeline/schedules/${scheduleId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false }),
      },
    );
    const updateBody = await updateRes.json();
    expect(updateBody.ok).toBe(true);
    expect(updateBody.data[0].enabled).toBe(false);

    // Delete the schedule
    const deleteRes = await fetch(
      `${baseUrl}/api/pipeline/schedules/${scheduleId}`,
      { method: "DELETE" },
    );
    const deleteBody = await deleteRes.json();
    expect(deleteBody.ok).toBe(true);
    expect(deleteBody.data).toEqual([]);
  });

  it("rejects invalid schedule payloads", async () => {
    const badHour = await fetch(`${baseUrl}/api/pipeline/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: "Bad", hour: 25, sources: ["linkedin"] }),
    });
    expect(badHour.status).toBe(400);

    const badSource = await fetch(`${baseUrl}/api/pipeline/schedules`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        label: "Bad",
        hour: 5,
        sources: ["not-a-source"],
      }),
    });
    expect(badSource.status).toBe(400);
  });

  it("validates pipeline run payloads", async () => {
    const badRun = await fetch(`${baseUrl}/api/pipeline/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ minSuitabilityScore: 120 }),
    });
    expect(badRun.status).toBe(400);

    const { runPipeline } = await import("@server/pipeline/index");
    const runRes = await fetch(`${baseUrl}/api/pipeline/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topN: 5, sources: ["linkedin"] }),
    });
    const runBody = await runRes.json();
    expect(runBody.ok).toBe(true);
    expect(runPipeline).toHaveBeenCalledWith({
      topN: 5,
      sources: ["linkedin"],
    });

    const glassdoorRunRes = await fetch(`${baseUrl}/api/pipeline/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: ["glassdoor"] }),
    });
    const glassdoorRunBody = await glassdoorRunRes.json();
    expect(glassdoorRunBody.ok).toBe(true);
    expect(runPipeline).toHaveBeenNthCalledWith(2, {
      sources: ["glassdoor"],
    });

    const adzunaRunRes = await fetch(`${baseUrl}/api/pipeline/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sources: ["adzuna"] }),
    });
    const adzunaRunBody = await adzunaRunRes.json();
    expect(adzunaRunBody.ok).toBe(true);
    expect(runPipeline).toHaveBeenNthCalledWith(3, {
      sources: ["adzuna"],
    });
  });

  it("returns conflict when cancelling with no active pipeline", async () => {
    const res = await fetch(`${baseUrl}/api/pipeline/cancel`, {
      method: "POST",
    });
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error.code).toBe("CONFLICT");
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("accepts cancellation when pipeline is running", async () => {
    const { requestPipelineCancel } = await import("@server/pipeline/index");
    vi.mocked(requestPipelineCancel).mockReturnValue({
      accepted: true,
      pipelineRunId: "run-1",
      alreadyRequested: false,
    });

    const res = await fetch(`${baseUrl}/api/pipeline/cancel`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.data.pipelineRunId).toBe("run-1");
    expect(body.data.alreadyRequested).toBe(false);
    expect(typeof body.meta.requestId).toBe("string");
  });

  it("streams pipeline progress over SSE", async () => {
    const controller = new AbortController();
    const res = await fetch(`${baseUrl}/api/pipeline/progress`, {
      signal: controller.signal,
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const reader = res.body?.getReader();
    if (reader) {
      try {
        const { value } = await reader.read();
        const text = new TextDecoder().decode(value);
        expect(text).toContain("data:");
        expect(text).toContain('"crawlingSource"');
        expect(text).toContain('"crawlingSourcesTotal"');
      } finally {
        await reader.cancel();
        controller.abort();
      }
    } else {
      controller.abort();
    }
  });
});
