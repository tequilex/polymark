import { describe, expect, it } from 'vitest';

import { listAlerts } from '../../src/db/repositories/alertsRepo';
import {
  getVolumeHistory,
  upsertVolumeHistory,
} from '../../src/db/repositories/volumeHistoryRepo';
import { runMigrations } from '../../src/db/migrate';
import { runMonitorIteration } from '../../src/worker/iteration';
import { runLoopTicks, startMonitorLoop } from '../../src/worker/loop';
import { createTestDb, listColumns, listIndexes, listTables } from '../helpers/testDb';

describe('database initialization', () => {
  it('creates required tables, columns and indexes idempotently', () => {
    const db = createTestDb();

    try {
      runMigrations(db);

      expect(listTables(db)).toContain('volume_history');
      expect(listTables(db)).toContain('alerts');

      expect(listColumns(db, 'volume_history')).toEqual([
        'market_id',
        'timestamp',
        'hourly_volume',
      ]);
      expect(listColumns(db, 'alerts')).toEqual([
        'id',
        'market_id',
        'question',
        'spike_amount',
        'baseline_avg',
        'multiplier',
        'price_yes_at_alert',
        'price_no_at_alert',
        'created_at',
        'resolved_at',
        'final_outcome',
        'pnl_if_yes',
        'pnl_if_no',
        'status',
      ]);

      expect(listIndexes(db, 'volume_history')).toEqual([
        'idx_volume_history_market',
        'idx_volume_history_timestamp',
      ]);
      expect(listIndexes(db, 'alerts')).toEqual([
        'idx_alerts_market_created',
        'idx_alerts_status_created',
      ]);

      expect(() => runMigrations(db)).not.toThrow();
      expect(listTables(db)).toContain('volume_history');
      expect(listTables(db)).toContain('alerts');
    } finally {
      db.close();
    }
  });
});

describe('monitor iteration', () => {
  it('stores current hour volume and creates alert when thresholds are met', async () => {
    const db = createTestDb();
    runMigrations(db);

    const nowSec = 1_710_000_300;
    const currentHourStart = nowSec - (nowSec % 3600);

    // База: 24 завершенных часа по 100 USD.
    for (let i = 1; i <= 24; i += 1) {
      upsertVolumeHistory(db, {
        marketId: 'm-1',
        timestamp: currentHourStart - i * 3600,
        hourlyVolume: 100,
      });
    }

    const gammaClient = {
      getTopActiveMarkets: async () => [
        {
          id: 'm-1',
          question: 'Will X happen?',
          yesPrice: 0.61,
          noPrice: 0.39,
        },
      ],
    };

    const clobClient = {
      getTradesByMarket: async () => [
        { timestamp: currentHourStart + 10, usdVolume: 350 },
        { timestamp: currentHourStart + 20, usdVolume: 260 },
      ],
    };

    try {
      const stats = await runMonitorIteration({
        db,
        gammaClient,
        clobClient,
        nowSec,
        topMarketsLimit: 100,
        baselineDays: 7,
        alertMultiplier: 5,
        alertMinVolume: 300,
        alertCooldownHours: 6,
        requestConcurrency: 4,
      });

      const alerts = listAlerts(db, { limit: 10, offset: 0 });
      const history = getVolumeHistory(
        db,
        'm-1',
        currentHourStart,
        currentHourStart
      );

      expect(stats.marketsProcessed).toBe(1);
      expect(stats.alertsCreated).toBe(1);
      expect(stats.errorsCount).toBe(0);
      expect(history).toHaveLength(1);
      expect(history[0]?.timestamp).toBe(currentHourStart);
      expect(history[0]?.hourlyVolume).toBe(610);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.marketId).toBe('m-1');
      expect(alerts[0]?.status).toBe('OPEN');
      expect(alerts[0]?.baselineAvg).toBe(100);
      expect(alerts[0]?.multiplier).toBeCloseTo(6.1);
      expect(alerts[0]?.spikeAmount).toBeCloseTo(510);
    } finally {
      db.close();
    }
  });

  it('returns iteration stats when gamma markets fetch fails', async () => {
    const db = createTestDb();
    runMigrations(db);

    const gammaClient = {
      getTopActiveMarkets: async () => {
        throw new Error('gamma unavailable');
      },
    };

    const clobClient = {
      getTradesByMarket: async () => [],
    };

    try {
      const stats = await runMonitorIteration({
        db,
        gammaClient,
        clobClient,
        nowSec: 1_710_000_300,
        topMarketsLimit: 100,
        baselineDays: 7,
        alertMultiplier: 5,
        alertMinVolume: 300,
        alertCooldownHours: 6,
        requestConcurrency: 4,
      });

      expect(stats.marketsProcessed).toBe(0);
      expect(stats.alertsCreated).toBe(0);
      expect(stats.errorsCount).toBe(1);
    } finally {
      db.close();
    }
  });

  it('warns when trades pagination reaches cap and may truncate data', async () => {
    const db = createTestDb();
    runMigrations(db);

    const nowSec = 1_710_000_300;
    const currentHourStart = nowSec - (nowSec % 3600);

    for (let i = 1; i <= 24; i += 1) {
      upsertVolumeHistory(db, {
        marketId: 'm-1',
        timestamp: currentHourStart - i * 3600,
        hourlyVolume: 100,
      });
    }

    const gammaClient = {
      getTopActiveMarkets: async () => [{ id: 'm-1', question: 'Q1' }],
    };

    const clobClient = {
      getTradesByMarket: async () => [
        { timestamp: currentHourStart + 10, usdVolume: 100 },
        { timestamp: currentHourStart + 20, usdVolume: 100 },
      ],
    };

    const warnings: string[] = [];
    const logger = {
      warn: (_meta: Record<string, unknown>, message?: string) => {
        warnings.push(message ?? '');
      },
    };

    try {
      await runMonitorIteration({
        db,
        gammaClient,
        clobClient,
        nowSec,
        topMarketsLimit: 100,
        baselineDays: 7,
        alertMultiplier: 5,
        alertMinVolume: 300,
        alertCooldownHours: 6,
        requestConcurrency: 4,
        tradePageSize: 2,
        maxTradePages: 2,
        logger,
      });

      expect(warnings).toContain(
        'iteration trades truncated by pagination cap'
      );
    } finally {
      db.close();
    }
  });
});

describe('monitor loop', () => {
  it('runs resolver every 10 iterations', async () => {
    let iterationCalls = 0;
    let resolveCalls = 0;

    await runLoopTicks(
      {
        resolveEveryNIterations: 10,
        runIteration: async () => {
          iterationCalls += 1;
          return {
            marketsProcessed: 0,
            alertsCreated: 0,
            errorsCount: 0,
          };
        },
        resolveAlerts: async () => {
          resolveCalls += 1;
          return 0;
        },
      },
      10
    );

    expect(iterationCalls).toBe(10);
    expect(resolveCalls).toBe(1);
  });
});

describe('monitor loop shutdown', () => {
  it('stops loop immediately without waiting full poll interval', async () => {
    let firstTickDone = false;

    const loop = startMonitorLoop({
      pollIntervalSec: 5,
      resolveEveryNIterations: 10,
      runIteration: async () => {
        firstTickDone = true;
        return {
          marketsProcessed: 0,
          alertsCreated: 0,
          errorsCount: 0,
        };
      },
      resolveAlerts: async () => 0,
    });

    while (!firstTickDone) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    loop.stop();

    const stoppedQuickly = await Promise.race([
      loop.done.then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 150);
      }),
    ]);

    expect(stoppedQuickly).toBe(true);
  });
});

describe('monitor loop shutdown with custom sleep', () => {
  it('stops loop even when custom sleep is pending', async () => {
    let firstTickDone = false;
    const releaseSleepRef: { current: (() => void) | null } = { current: null };

    let resolveSleepStarted: (() => void) | null = null;
    const sleepStarted = new Promise<void>((resolve) => {
      resolveSleepStarted = resolve;
    });

    const loop = startMonitorLoop({
      pollIntervalSec: 5,
      resolveEveryNIterations: 10,
      runIteration: async () => {
        firstTickDone = true;
        return {
          marketsProcessed: 0,
          alertsCreated: 0,
          errorsCount: 0,
        };
      },
      resolveAlerts: async () => 0,
      sleepFn: async () => {
        await new Promise<void>((resolve) => {
          releaseSleepRef.current = () => {
            resolve();
          };
          resolveSleepStarted?.();
        });
      },
    });

    while (!firstTickDone) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    await sleepStarted;

    loop.stop();

    const stoppedQuickly = await Promise.race([
      loop.done.then(() => true),
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), 150);
      }),
    ]);

    releaseSleepRef.current?.();

    expect(stoppedQuickly).toBe(true);
  });
});

describe('monitor iteration market id mapping', () => {
  it('uses gamma conditionId for trades requests when available', async () => {
    const db = createTestDb();
    runMigrations(db);

    let requestedMarketId = '';

    const gammaClient = {
      getTopActiveMarkets: async () => [
        {
          id: 'm-raw-id',
          conditionId:
            '0xb48621f7eba07b0a3eeabc6afb09ae42490239903997b9d412b0f69aeb040c8b',
          question: 'Q',
        },
      ],
    };

    const clobClient = {
      getTradesByMarket: async (marketId: string) => {
        requestedMarketId = marketId;
        return [];
      },
    };

    try {
      await runMonitorIteration({
        db,
        gammaClient,
        clobClient,
        nowSec: 1_710_000_300,
        topMarketsLimit: 100,
        baselineDays: 7,
        alertMultiplier: 5,
        alertMinVolume: 300,
        alertCooldownHours: 6,
        requestConcurrency: 4,
      });

      expect(requestedMarketId).toBe(
        '0xb48621f7eba07b0a3eeabc6afb09ae42490239903997b9d412b0f69aeb040c8b'
      );
    } finally {
      db.close();
    }
  });
});

describe('monitor iteration data-api pagination guard', () => {
  it('does not request trades with offset greater than 3000', async () => {
    const db = createTestDb();
    runMigrations(db);

    const nowSec = 1_710_000_300;
    const currentHourStart = nowSec - (nowSec % 3600);

    for (let i = 1; i <= 24; i += 1) {
      upsertVolumeHistory(db, {
        marketId: 'm-1',
        timestamp: currentHourStart - i * 3600,
        hourlyVolume: 100,
      });
    }

    const offsets: number[] = [];

    const gammaClient = {
      getTopActiveMarkets: async () => [
        {
          id: 'm-1',
          conditionId:
            '0xb48621f7eba07b0a3eeabc6afb09ae42490239903997b9d412b0f69aeb040c8b',
          question: 'Q',
        },
      ],
    };

    const clobClient = {
      getTradesByMarket: async (
        _marketId: string,
        _limit = 500,
        offset = 0
      ) => {
        offsets.push(offset);
        return Array.from({ length: _limit }, () => ({
          timestamp: currentHourStart + 10,
          usdVolume: 10,
        }));
      },
    };

    try {
      await runMonitorIteration({
        db,
        gammaClient,
        clobClient,
        nowSec,
        topMarketsLimit: 100,
        baselineDays: 7,
        alertMultiplier: 5,
        alertMinVolume: 300,
        alertCooldownHours: 6,
        requestConcurrency: 4,
        tradePageSize: 500,
        maxTradePages: 10,
      });

      expect(Math.max(...offsets)).toBeLessThanOrEqual(3000);
      expect(offsets).not.toContain(3500);
    } finally {
      db.close();
    }
  });

  it('stops pagination when page already contains trades older than current hour', async () => {
    const db = createTestDb();
    runMigrations(db);

    const nowSec = 1_710_000_300;
    const currentHourStart = nowSec - (nowSec % 3600);

    for (let i = 1; i <= 24; i += 1) {
      upsertVolumeHistory(db, {
        marketId: 'm-2',
        timestamp: currentHourStart - i * 3600,
        hourlyVolume: 100,
      });
    }

    const offsets: number[] = [];

    const gammaClient = {
      getTopActiveMarkets: async () => [
        {
          id: 'm-2',
          conditionId:
            '0xb48621f7eba07b0a3eeabc6afb09ae42490239903997b9d412b0f69aeb040c8b',
          question: 'Q',
        },
      ],
    };

    const clobClient = {
      getTradesByMarket: async (
        _marketId: string,
        _limit = 2,
        offset = 0
      ) => {
        offsets.push(offset);

        if (offset === 0) {
          return [
            { timestamp: currentHourStart + 120, usdVolume: 10 },
            { timestamp: currentHourStart + 60, usdVolume: 10 },
          ];
        }

        if (offset === 2) {
          return [
            { timestamp: currentHourStart + 1, usdVolume: 10 },
            { timestamp: currentHourStart - 1, usdVolume: 10 },
          ];
        }

        return [
          { timestamp: currentHourStart - 10, usdVolume: 10 },
          { timestamp: currentHourStart - 20, usdVolume: 10 },
        ];
      },
    };

    try {
      await runMonitorIteration({
        db,
        gammaClient,
        clobClient,
        nowSec,
        topMarketsLimit: 100,
        baselineDays: 7,
        alertMultiplier: 5,
        alertMinVolume: 300,
        alertCooldownHours: 6,
        requestConcurrency: 4,
        tradePageSize: 2,
        maxTradePages: 10,
      });

      expect(offsets).toEqual([0, 2]);
      expect(offsets).not.toContain(4);
    } finally {
      db.close();
    }
  });
});
