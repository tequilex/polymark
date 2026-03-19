import { describe, expect, it } from 'vitest';

import { listAlerts } from '../../src/db/repositories/alertsRepo';
import {
  getVolumeHistory,
  upsertVolumeHistory,
} from '../../src/db/repositories/volumeHistoryRepo';
import { runMigrations } from '../../src/db/migrate';
import { runMonitorIteration } from '../../src/worker/iteration';
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
});
