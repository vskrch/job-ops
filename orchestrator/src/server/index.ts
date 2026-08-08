/**
 * Express server entry point.
 */

import "./config/env";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { createApp } from "./app";
import { initializeExtractorRegistry } from "./extractors/registry";
import * as pipelineRepo from "./repositories/pipeline";
import * as settingsRepo from "./repositories/settings";
import {
  getBackupSettings,
  setBackupSettings,
  startBackupScheduler,
} from "./services/backup/index";
import { initializeDemoModeServices } from "./services/demo-mode";
import { applyStoredEnvOverrides } from "./services/envSettings";
import { refreshPipelineScheduler } from "./services/pipeline-scheduler";
import { initialize as initializeVisaSponsors } from "./services/visa-sponsors/index";

async function startServer() {
  await applyStoredEnvOverrides();
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

  const app = createApp();
  const PORT = Number(process.env.PORT) || 3001;

  // Start server
  const server = app.listen(PORT, "0.0.0.0", async () => {
    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀 Job Ops Orchestrator                                 ║
║                                                           ║
║   Server running at: http://0.0.0.0:${PORT}                 ║
║                                                           ║
║   API:     http://0.0.0.0:${PORT}/api                       ║
║   Health:  http://0.0.0.0:${PORT}/health                    ║
║   PDFs:    http://0.0.0.0:${PORT}/pdfs                      ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);

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

    // Initialize the scheduled pipeline runner (overnight scan at a
    // configurable UTC hour instead of only ad-hoc manual runs).
    try {
      await refreshPipelineScheduler();
    } catch (error) {
      logger.warn("Failed to initialize scheduled pipeline runner", {
        error: sanitizeUnknown(error),
      });
    }
  });

  const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}. Shutting down HTTP server...`);
    server.close(() => {
      logger.info("HTTP server closed. Exiting process.");
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Forced shutdown after timeout.");
      process.exit(1);
    }, 10000).unref();
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
}

void startServer();
