/**
 * Express server entry point.
 */

import "./config/env";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { createApp } from "./app";
import { closeDb } from "./db/index";
import { initializeExtractorRegistry } from "./extractors/registry";
import * as agenticRepo from "./repositories/agentic-search";
import * as jobSearchRepo from "./repositories/job-search";
import * as pipelineRepo from "./repositories/pipeline";
import * as settingsRepo from "./repositories/settings";
import {
  getBackupSettings,
  registerBackupListener,
  setBackupSettings,
  startBackupScheduler,
  stopBackupScheduler,
} from "./services/backup/index";
import { initializeDemoModeServices } from "./services/demo-mode";
import { applyStoredEnvOverrides } from "./services/envSettings";
import {
  startKeepAliveService,
  stopKeepAliveService,
} from "./services/keep-alive";
import {
  refreshPipelineScheduler,
  stopAllPipelineSchedulers,
} from "./services/pipeline-scheduler";
import {
  isRemoteBackupConfigured,
  syncBackupToRemote,
} from "./services/remote-backup/index";
import {
  refreshSearchScheduler,
  stopAllSearchSchedulers,
} from "./services/search-scheduler";
import { getEffectiveSettings } from "./services/settings";
import { initialize as initializeVisaSponsors } from "./services/visa-sponsors/index";

async function startServer() {
  await applyStoredEnvOverrides();

  // Session tokens are HMAC-signed; a missing/weak secret in production
  // lets anyone forge cookies and impersonate any user. Fail fast instead.
  if (
    process.env.NODE_ENV === "production" &&
    !process.env.SESSION_SECRET?.trim()
  ) {
    logger.error(
      "SESSION_SECRET is required in production. Refusing to start.",
    );
    process.exit(1);
  }

  // In production, refuse to start with no authentication configured.
  // Without BASIC_AUTH or session-based auth, all API routes are open.
  // AUTH_MODE=session (per-user accounts, anonymous /api rejected) also
  // counts as authentication. Allow opt-out via ALLOW_NO_AUTH=true for
  // single-user/self-hosted scenarios.
  if (
    process.env.NODE_ENV === "production" &&
    process.env.AUTH_MODE?.trim() !== "session" &&
    !process.env.BASIC_AUTH_USER?.trim() &&
    !process.env.BASIC_AUTH_PASSWORD?.trim() &&
    process.env.ALLOW_NO_AUTH !== "true"
  ) {
    logger.error(
      "No authentication configured. Set AUTH_MODE=session for per-user accounts, set BASIC_AUTH_USER and BASIC_AUTH_PASSWORD, or set ALLOW_NO_AUTH=true to acknowledge the risk. Refusing to start.",
    );
    process.exit(1);
  }

  // Mirror every successful local backup to the remote (S3/R2) store.
  registerBackupListener(() => {
    void syncBackupToRemote();
  });
  try {
    await initializeExtractorRegistry();
  } catch (error) {
    const sanitizedError = sanitizeUnknown(error);
    logger.error("Failed to initialize extractor registry", {
      error: sanitizedError,
    });
    if (process.env.NODE_ENV === "production") {
      logger.error(
        "Extractor registry initialization failed in production. Shutting down server.",
      );
      process.exit(1);
    }

    logger.error(
      "Extractor registry initialization failed outside production. Server startup aborted.",
    );
    return;
  }

  // Recover from unclean shutdown: mark any orphaned pipeline runs as failed
  try {
    const orphaned = await pipelineRepo.markOrphanedRunsAsFailed();
    if (orphaned > 0) {
      logger.warn("Marked orphaned pipeline runs as failed", {
        count: orphaned,
      });
    }
  } catch (error) {
    logger.warn("Failed to recover orphaned pipeline runs", {
      error: sanitizeUnknown(error),
    });
  }

  // Recover from unclean shutdown: mark any orphaned job searches as failed
  try {
    const orphanedSearches = await jobSearchRepo.markOrphanedSearchesAsFailed();
    if (orphanedSearches > 0) {
      logger.warn("Marked orphaned job searches as failed", {
        count: orphanedSearches,
      });
    }
  } catch (error) {
    logger.warn("Failed to recover orphaned job searches", {
      error: sanitizeUnknown(error),
    });
  }

  const app = createApp();
  const PORT = Number(process.env.PORT) || 3001;

  // Start server
  const server = app.listen(PORT, "0.0.0.0", async () => {
    logger.info("Job Ops Orchestrator server started", { port: PORT });

    // Initialize visa sponsors service (downloads data if needed, starts scheduler)
    try {
      if (process.env.DEMO_MODE === "true") {
        logger.info(
          "Demo mode enabled. Skipping visa sponsors initialization.",
        );
      } else {
        await initializeVisaSponsors();
      }
    } catch (error) {
      logger.warn("Failed to initialize visa sponsors service", {
        error: sanitizeUnknown(error),
      });
    }

    // Initialize backup service (load settings and start scheduler if enabled)
    try {
      const backupEnabled = await settingsRepo.getSetting("backupEnabled");
      const backupHour = await settingsRepo.getSetting("backupHour");
      const backupMaxCount = await settingsRepo.getSetting("backupMaxCount");

      const parsedHour = backupHour ? parseInt(backupHour, 10) : NaN;
      const parsedMaxCount = backupMaxCount
        ? parseInt(backupMaxCount, 10)
        : NaN;
      const safeHour = Number.isNaN(parsedHour)
        ? 2
        : Math.min(23, Math.max(0, parsedHour));
      const safeMaxCount = Number.isNaN(parsedMaxCount)
        ? 5
        : Math.min(5, Math.max(1, parsedMaxCount));

      setBackupSettings({
        enabled: backupEnabled === "true" || backupEnabled === "1",
        hour: safeHour,
        maxCount: safeMaxCount,
      });

      startBackupScheduler();

      const settings = getBackupSettings();
      if (settings.enabled) {
        logger.info("Backup scheduler started", {
          hour: settings.hour,
          maxCount: settings.maxCount,
        });
      } else {
        logger.info(
          "Backups disabled. Enable in settings to schedule automatic backups.",
        );
      }
    } catch (error) {
      logger.warn("Failed to initialize backup service", {
        error: sanitizeUnknown(error),
      });
    }

    try {
      await initializeDemoModeServices();
    } catch (error) {
      logger.warn("Failed to initialize demo mode services", {
        error: sanitizeUnknown(error),
      });
    }

    // Baseline snapshot in the remote store (covers fresh boots where local
    // backups are disabled).
    try {
      if (isRemoteBackupConfigured()) {
        await syncBackupToRemote();
      }
    } catch (error) {
      logger.warn("Failed to upload startup database snapshot", {
        error: sanitizeUnknown(error),
      });
    }

    // Initialize the scheduled pipeline runner (overnight scan at a
    // configurable UTC hour instead of only ad-hoc manual runs).
    try {
      // Apply the configured max concurrent pipeline runs setting before
      // starting the scheduler so the semaphore is correctly sized.
      const { setMaxConcurrentPipelines } = await import(
        "./pipeline/orchestrator"
      );
      const effectiveSettings = await getEffectiveSettings();
      setMaxConcurrentPipelines(
        effectiveSettings.pipelineMaxConcurrentRuns?.value ?? 3,
      );
      await refreshPipelineScheduler();
    } catch (error) {
      logger.warn("Failed to initialize scheduled pipeline runner", {
        error: sanitizeUnknown(error),
      });
    }

    // Initialize the scheduled search runner (periodic NL searches).
    try {
      await refreshSearchScheduler();
    } catch (error) {
      logger.warn("Failed to initialize scheduled search runner", {
        error: sanitizeUnknown(error),
      });
    }

    // Recover agentic searches interrupted by a restart: in-progress rows
    // can never resume in-process, so mark them failed instead of leaving
    // them stuck in a non-terminal state.
    try {
      const orphaned = await agenticRepo.markOrphanedAgenticSearchesAsFailed();
      if (orphaned > 0) {
        logger.warn("Marked orphaned agentic searches as failed", {
          count: orphaned,
        });
      }
    } catch (error) {
      logger.warn("Failed to recover orphaned agentic searches", {
        error: sanitizeUnknown(error),
      });
    }

    // Start self-ping keep-alive service to prevent Heroku Eco dyno from sleeping
    try {
      startKeepAliveService();
    } catch (error) {
      logger.warn("Failed to start keep-alive service", {
        error: sanitizeUnknown(error),
      });
    }
  });

  const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Shutting down HTTP server...`);
    stopKeepAliveService();
    stopAllSearchSchedulers();
    stopAllPipelineSchedulers();
    stopBackupScheduler();
    const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 30_000;
    const forceExit = setTimeout(() => {
      logger.error("Forced shutdown after timeout.", {
        timeoutMs: GRACEFUL_SHUTDOWN_TIMEOUT_MS,
      });
      process.exit(1);
    }, GRACEFUL_SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    const finish = () => {
      clearTimeout(forceExit);
      server.close(() => {
        closeDb();
        logger.info("HTTP server closed. Exiting process.");
        process.exit(0);
      });
    };

    // Persist a fresh snapshot before the dyno goes away — on ephemeral
    // filesystems (Heroku) this is the last chance before the disk is wiped.
    // Race the upload against the force-exit timeout so we don't kill mid-upload.
    if (isRemoteBackupConfigured()) {
      const upload = syncBackupToRemote();
      // Ensure finish is called even if upload hangs; the timeout above will force exit
      void upload
        .catch((error) => {
          logger.warn("Remote backup sync failed during shutdown", {
            error: sanitizeUnknown(error),
          });
        })
        .finally(finish);
      return;
    }
    finish();
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", {
      error: sanitizeUnknown(reason),
    });
  });
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", { error: sanitizeUnknown(error) });
    process.exit(1);
  });
}

void startServer();
