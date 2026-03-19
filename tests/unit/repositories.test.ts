import { describe, expect, it } from 'vitest';

import {
  createAlert,
  listAlerts,
} from '../../src/db/repositories/alertsRepo';
import {
  getVolumeHistory,
  upsertVolumeHistory,
} from '../../src/db/repositories/volumeHistoryRepo';
import { runMigrations } from '../../src/db/migrate';
import { createTestDb } from '../helpers/testDb';

describe('volumeHistoryRepo', () => {
  it('supports one-sided time filters', () => {
    const db = createTestDb();
    runMigrations(db);

    upsertVolumeHistory(db, {
      marketId: 'm-1',
      timestamp: 100,
      hourlyVolume: 1,
    });
    upsertVolumeHistory(db, {
      marketId: 'm-1',
      timestamp: 200,
      hourlyVolume: 2,
    });
    upsertVolumeHistory(db, {
      marketId: 'm-1',
      timestamp: 300,
      hourlyVolume: 3,
    });

    expect(getVolumeHistory(db, 'm-1', 200)).toEqual([
      { timestamp: 200, hourlyVolume: 2 },
      { timestamp: 300, hourlyVolume: 3 },
    ]);

    expect(getVolumeHistory(db, 'm-1', undefined, 200)).toEqual([
      { timestamp: 100, hourlyVolume: 1 },
      { timestamp: 200, hourlyVolume: 2 },
    ]);

    db.close();
  });
});

describe('alertsRepo', () => {
  it('clamps limit and offset and keeps stable ordering', () => {
    const db = createTestDb();
    runMigrations(db);

    createAlert(db, {
      marketId: 'm-1',
      question: 'Q1',
      spikeAmount: 10,
      baselineAvg: 2,
      multiplier: 6,
      priceYesAtAlert: 0.5,
      priceNoAtAlert: 0.5,
      createdAt: 1000,
    });
    createAlert(db, {
      marketId: 'm-1',
      question: 'Q2',
      spikeAmount: 11,
      baselineAvg: 2,
      multiplier: 7,
      priceYesAtAlert: 0.5,
      priceNoAtAlert: 0.5,
      createdAt: 1000,
    });

    const ordered = listAlerts(db, { limit: 50, offset: 0 });
    expect(ordered[0]?.id).toBeGreaterThan(ordered[1]?.id ?? 0);

    const clamped = listAlerts(db, { limit: 999_999, offset: -9 });
    expect(clamped.length).toBe(2);

    db.close();
  });
});
