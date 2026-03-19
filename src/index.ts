import { buildServer } from './api/server';
import { config } from './config';
import { createDatabase } from './db/client';
import { runMigrations } from './db/migrate';
import { logger } from './logger';
import { ClobClient } from './polymarket/clobClient';
import { GammaClient } from './polymarket/gammaClient';
import type { AppHealth } from './types';
import { runMonitorIteration } from './worker/iteration';
import { startMonitorLoop } from './worker/loop';
import { resolveOpenAlerts } from './worker/resolver';

const DAY_SEC = 24 * 3600;

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function trimOldErrors(errorTimestamps: number[], currentSec: number): void {
  const threshold = currentSec - DAY_SEC;

  while (errorTimestamps.length > 0 && errorTimestamps[0] < threshold) {
    errorTimestamps.shift();
  }
}

function pushIterationErrors(
  errorTimestamps: number[],
  count: number,
  timestampSec: number
): void {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;

  for (let i = 0; i < safeCount; i += 1) {
    errorTimestamps.push(timestampSec);
  }
}

async function main(): Promise<void> {
  const db = createDatabase(config.dbPath);
  runMigrations(db);

  const gammaClient = new GammaClient({
    timeoutMs: config.requestTimeoutMs,
    retries: config.requestRetries,
  });

  const clobClient = new ClobClient({
    timeoutMs: config.requestTimeoutMs,
    retries: config.requestRetries,
  });

  const iterationErrorTimestamps: number[] = [];
  let lastSuccessfulIterationAt: number | null = null;

  const getHealth = (): AppHealth => {
    const currentSec = nowSec();
    trimOldErrors(iterationErrorTimestamps, currentSec);

    const iterationErrors24h = iterationErrorTimestamps.length;

    return {
      status: iterationErrors24h > 0 ? 'degraded' : 'ok',
      lastSuccessfulIterationAt,
      iterationErrors24h,
      db: 'ok',
    };
  };

  const app = buildServer({
    db,
    getHealth,
    enableLogger: false,
    corsOrigin: config.corsOrigin,
  });

  const loopHandle = startMonitorLoop({
    pollIntervalSec: config.pollIntervalSec,
    resolveEveryNIterations: config.resolveEveryNIterations,
    logger,
    runIteration: async () => {
      const stats = await runMonitorIteration({
        db,
        gammaClient,
        clobClient,
        topMarketsLimit: config.topMarketsLimit,
        baselineDays: config.baselineDays,
        alertMultiplier: config.alertMultiplier,
        alertMinVolume: config.alertMinVolume,
        alertCooldownHours: config.alertCooldownHours,
        requestConcurrency: config.requestConcurrency,
        logger,
      });

      const currentSec = nowSec();
      lastSuccessfulIterationAt = currentSec;
      pushIterationErrors(iterationErrorTimestamps, stats.errorsCount, currentSec);
      trimOldErrors(iterationErrorTimestamps, currentSec);

      logger.info(
        {
          marketsProcessed: stats.marketsProcessed,
          alertsCreated: stats.alertsCreated,
          errorsCount: stats.errorsCount,
        },
        'monitor iteration completed'
      );

      return stats;
    },
    resolveAlerts: async () => {
      const resolved = await resolveOpenAlerts({
        db,
        gammaClient,
      });

      logger.info(
        {
          resolved,
        },
        'monitor resolver completed'
      );

      return resolved;
    },
    onIterationError: (timestampSec) => {
      pushIterationErrors(iterationErrorTimestamps, 1, timestampSec);
      trimOldErrors(iterationErrorTimestamps, timestampSec);
    },
  });

  const serverAddress = await app.listen({
    port: config.port,
    host: '0.0.0.0',
  });

  logger.info(
    {
      address: serverAddress,
      dbPath: config.dbPath,
      pollIntervalSec: config.pollIntervalSec,
    },
    'service started'
  );

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logger.info({ signal }, 'shutdown requested');

    loopHandle.stop();

    try {
      await loopHandle.done;
    } catch (error) {
      logger.warn({ err: error }, 'loop stop error');
    }

    await app.close();
    db.close();
    logger.info('service stopped');
    process.exit(0);
  };

  process.on('SIGINT', () => {
    void shutdown('SIGINT');
  });

  process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
  });
}

void main().catch((error) => {
  logger.error({ err: error }, 'service bootstrap failed');
  process.exit(1);
});
