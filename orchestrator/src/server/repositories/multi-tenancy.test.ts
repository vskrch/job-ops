import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe.sequential("multi-tenancy isolation", () => {
  const originalEnv = { ...process.env };
  let tempDir = "";
  let closeDb: (() => void) | null = null;
  let runWithRequestContext: typeof import("@infra/request-context").runWithRequestContext;

  beforeEach(async () => {
    vi.resetModules();
    tempDir = await mkdtemp(join(tmpdir(), "job-ops-multitenancy-test-"));
    process.env = {
      ...originalEnv,
      DATA_DIR: tempDir,
      NODE_ENV: "test",
    };

    const requestContextModule = await import("@infra/request-context");
    runWithRequestContext = requestContextModule.runWithRequestContext;

    await import("../db/migrate");
    const dbModule = await import("../db");
    closeDb = dbModule.closeDb;
  });

  afterEach(async () => {
    closeDb?.();
    closeDb = null;
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
    process.env = { ...originalEnv };
  });

  it("isolates pipeline schedules between user-a and user-b", async () => {
    const pipelineScheduleRepo = await import("./pipeline-schedules");

    // User A creates a schedule
    const scheduleA = await runWithRequestContext({ userId: "user-a" }, () =>
      pipelineScheduleRepo.createPipelineSchedule({
        label: "User A Schedule",
        hour: 3,
        sources: ["adzuna"],
        enabled: true,
      }),
    );

    // User B creates a schedule
    const scheduleB = await runWithRequestContext({ userId: "user-b" }, () =>
      pipelineScheduleRepo.createPipelineSchedule({
        label: "User B Schedule",
        hour: 5,
        sources: ["hiringcafe"],
        enabled: true,
      }),
    );

    // User A lists schedules -> only sees scheduleA
    const userASchedules = await runWithRequestContext(
      { userId: "user-a" },
      () => pipelineScheduleRepo.listPipelineSchedules(),
    );
    expect(userASchedules).toHaveLength(1);
    expect(userASchedules[0].id).toBe(scheduleA.id);
    expect(userASchedules[0].label).toBe("User A Schedule");

    // User B lists schedules -> only sees scheduleB
    const userBSchedules = await runWithRequestContext(
      { userId: "user-b" },
      () => pipelineScheduleRepo.listPipelineSchedules(),
    );
    expect(userBSchedules).toHaveLength(1);
    expect(userBSchedules[0].id).toBe(scheduleB.id);
    expect(userBSchedules[0].label).toBe("User B Schedule");

    // User A cannot get, update, or delete User B's schedule
    const userATryingToGetB = await runWithRequestContext(
      { userId: "user-a" },
      () => pipelineScheduleRepo.getPipelineScheduleById(scheduleB.id),
    );
    expect(userATryingToGetB).toBeNull();

    const userATryingToUpdateB = await runWithRequestContext(
      { userId: "user-a" },
      () =>
        pipelineScheduleRepo.updatePipelineSchedule(scheduleB.id, {
          label: "Hacked",
        }),
    );
    expect(userATryingToUpdateB).toBeNull();

    const userATryingToDeleteB = await runWithRequestContext(
      { userId: "user-a" },
      () => pipelineScheduleRepo.deletePipelineSchedule(scheduleB.id),
    );
    expect(userATryingToDeleteB).toBe(false);

    // Background runner gets all enabled schedules with user IDs intact
    const enabled = await pipelineScheduleRepo.getEnabledSchedules();
    expect(enabled).toHaveLength(2);
    expect(enabled.find((s) => s.id === scheduleA.id)?.userId).toBe("user-a");
    expect(enabled.find((s) => s.id === scheduleB.id)?.userId).toBe("user-b");
  });

  it("isolates search schedules between user-a and user-b", async () => {
    const searchScheduleRepo = await import("./search-schedules");

    // User A creates search schedule
    const searchA = await runWithRequestContext({ userId: "user-a" }, () =>
      searchScheduleRepo.createSearchSchedule({
        label: "User A Search",
        query: "Frontend Engineer in SF",
        frequency: "daily",
        hour: 9,
      }),
    );

    // User B creates search schedule
    const searchB = await runWithRequestContext({ userId: "user-b" }, () =>
      searchScheduleRepo.createSearchSchedule({
        label: "User B Search",
        query: "Backend Go Developer in NYC",
        frequency: "hourly",
      }),
    );

    // User A only sees searchA
    const userAList = await runWithRequestContext({ userId: "user-a" }, () =>
      searchScheduleRepo.listSearchSchedules(),
    );
    expect(userAList).toHaveLength(1);
    expect(userAList[0].id).toBe(searchA.id);

    // User B only sees searchB
    const userBList = await runWithRequestContext({ userId: "user-b" }, () =>
      searchScheduleRepo.listSearchSchedules(),
    );
    expect(userBList).toHaveLength(1);
    expect(userBList[0].id).toBe(searchB.id);

    // User A cannot get, update, or delete User B's search schedule
    const userAGetB = await runWithRequestContext({ userId: "user-a" }, () =>
      searchScheduleRepo.getSearchScheduleById(searchB.id),
    );
    expect(userAGetB).toBeNull();

    const userAUpdateB = await runWithRequestContext({ userId: "user-a" }, () =>
      searchScheduleRepo.updateSearchSchedule(searchB.id, {
        label: "Modified",
      }),
    );
    expect(userAUpdateB).toBeNull();

    const userADeleteB = await runWithRequestContext({ userId: "user-a" }, () =>
      searchScheduleRepo.deleteSearchSchedule(searchB.id),
    );
    expect(userADeleteB).toBe(false);
  });

  it("isolates design resume documents between user-a and user-b", async () => {
    const designResumeRepo = await import("./design-resume");

    // User A saves a design resume
    await runWithRequestContext({ userId: "user-a" }, () =>
      designResumeRepo.upsertDesignResumeDocument({
        id: "doc-a",
        title: "User A Resume",
        resumeJson: { basics: { name: "Alice" } },
        revision: 1,
        sourceResumeId: null,
        sourceMode: null,
        importedAt: null,
        updatedAt: new Date().toISOString(),
      }),
    );

    // User B saves a design resume
    await runWithRequestContext({ userId: "user-b" }, () =>
      designResumeRepo.upsertDesignResumeDocument({
        id: "doc-b",
        title: "User B Resume",
        resumeJson: { basics: { name: "Bob" } },
        revision: 1,
        sourceResumeId: null,
        sourceMode: null,
        importedAt: null,
        updatedAt: new Date().toISOString(),
      }),
    );

    // User A gets latest design resume -> Alice
    const latestA = await runWithRequestContext({ userId: "user-a" }, () =>
      designResumeRepo.getLatestDesignResumeDocument(),
    );
    expect(latestA?.id).toBe("doc-a");
    expect(latestA?.title).toBe("User A Resume");

    // User B gets latest design resume -> Bob
    const latestB = await runWithRequestContext({ userId: "user-b" }, () =>
      designResumeRepo.getLatestDesignResumeDocument(),
    );
    expect(latestB?.id).toBe("doc-b");
    expect(latestB?.title).toBe("User B Resume");

    // User A cannot read or delete doc-b
    const docBFromA = await runWithRequestContext({ userId: "user-a" }, () =>
      designResumeRepo.getDesignResumeDocumentById("doc-b"),
    );
    expect(docBFromA).toBeNull();
  });

  it("isolates post-application integrations and messages between user-a and user-b", async () => {
    const integrationRepo = await import("./post-application-integrations");
    const messageRepo = await import("./post-application-messages");

    // User A connects Gmail
    await runWithRequestContext({ userId: "user-a" }, () =>
      integrationRepo.upsertConnectedPostApplicationIntegration({
        provider: "gmail",
        accountKey: "default",
        displayName: "alice@example.com",
        credentials: { token: "secret-a" },
      }),
    );

    // User B connects Gmail
    await runWithRequestContext({ userId: "user-b" }, () =>
      integrationRepo.upsertConnectedPostApplicationIntegration({
        provider: "gmail",
        accountKey: "default",
        displayName: "bob@example.com",
        credentials: { token: "secret-b" },
      }),
    );

    // User A retrieves integration
    const intA = await runWithRequestContext({ userId: "user-a" }, () =>
      integrationRepo.getPostApplicationIntegration("gmail", "default"),
    );
    expect(intA?.displayName).toBe("alice@example.com");

    // User B retrieves integration
    const intB = await runWithRequestContext({ userId: "user-b" }, () =>
      integrationRepo.getPostApplicationIntegration("gmail", "default"),
    );
    expect(intB?.displayName).toBe("bob@example.com");

    // User A inserts a message
    await runWithRequestContext({ userId: "user-a" }, () =>
      messageRepo.upsertPostApplicationMessage({
        provider: "gmail",
        accountKey: "default",
        integrationId: intA?.id ?? "int-a",
        syncRunId: null,
        externalMessageId: "msg-123",
        fromAddress: "recruiter@corp.com",
        subject: "Interview with Alice",
        receivedAt: Date.now(),
        snippet: "Hi Alice",
        relevanceDecision: "relevant",
        messageType: "interview",
        processingStatus: "pending_user",
      }),
    );

    // User A sees 1 pending message
    const msgsA = await runWithRequestContext({ userId: "user-a" }, () =>
      messageRepo.listPostApplicationMessagesByProcessingStatus(
        "gmail",
        "default",
        "pending_user",
      ),
    );
    expect(msgsA).toHaveLength(1);
    expect(msgsA[0].subject).toBe("Interview with Alice");

    // User B sees 0 pending messages
    const msgsB = await runWithRequestContext({ userId: "user-b" }, () =>
      messageRepo.listPostApplicationMessagesByProcessingStatus(
        "gmail",
        "default",
        "pending_user",
      ),
    );
    expect(msgsB).toHaveLength(0);
  });
});
