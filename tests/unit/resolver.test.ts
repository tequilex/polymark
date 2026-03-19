import { describe, expect, it } from 'vitest';

import {
  createAlert,
  getAlertById,
} from '../../src/db/repositories/alertsRepo';
import { runMigrations } from '../../src/db/migrate';
import { resolveOpenAlerts } from '../../src/worker/resolver';
import { createTestDb } from '../helpers/testDb';

describe('resolveOpenAlerts', () => {
  it('resolves OPEN alert and calculates P&L for YES outcome', async () => {
    const db = createTestDb();
    runMigrations(db);

    const alertId = createAlert(db, {
      marketId: 'm-1',
      question: 'Will X happen?',
      spikeAmount: 400,
      baselineAvg: 100,
      multiplier: 5,
      priceYesAtAlert: 0.6,
      priceNoAtAlert: 0.4,
      createdAt: 1_710_000_000,
    });

    const gammaClient = {
      getMarketById: async (marketId: string) => {
        if (marketId !== 'm-1') {
          return null;
        }

        return {
          id: 'm-1',
          closed: true,
          outcome: 'YES',
        };
      },
    };

    const resolved = await resolveOpenAlerts({
      db,
      gammaClient,
      nowSec: 1_710_000_900,
    });

    const updated = getAlertById(db, alertId);

    expect(resolved).toBe(1);
    expect(updated?.status).toBe('RESOLVED');
    expect(updated?.finalOutcome).toBe('YES');
    expect(updated?.pnlIfYes).toBeCloseTo(0.4);
    expect(updated?.pnlIfNo).toBeCloseTo(-0.4);

    db.close();
  });

  it('keeps alert OPEN when market is not closed yet', async () => {
    const db = createTestDb();
    runMigrations(db);

    const alertId = createAlert(db, {
      marketId: 'm-2',
      question: 'Will Y happen?',
      spikeAmount: 300,
      baselineAvg: 100,
      multiplier: 4,
      priceYesAtAlert: 0.55,
      priceNoAtAlert: 0.45,
      createdAt: 1_710_000_000,
    });

    const gammaClient = {
      getMarketById: async () => ({
        id: 'm-2',
        closed: false,
      }),
    };

    const resolved = await resolveOpenAlerts({
      db,
      gammaClient,
      nowSec: 1_710_000_900,
    });

    const updated = getAlertById(db, alertId);

    expect(resolved).toBe(0);
    expect(updated?.status).toBe('OPEN');

    db.close();
  });

  it('keeps alert OPEN when market closes with unknown outcome', async () => {
    const db = createTestDb();
    runMigrations(db);

    const alertId = createAlert(db, {
      marketId: 'm-3',
      question: 'Will Z happen?',
      spikeAmount: 300,
      baselineAvg: 100,
      multiplier: 4,
      priceYesAtAlert: 0.52,
      priceNoAtAlert: 0.48,
      createdAt: 1_710_000_000,
    });

    const gammaClient = {
      getMarketById: async () => ({
        id: 'm-3',
        closed: true,
        outcome: 'MAYBE',
      }),
    };

    await resolveOpenAlerts({
      db,
      gammaClient,
      nowSec: 1_710_000_900,
    });

    const updated = getAlertById(db, alertId);
    expect(updated?.status).toBe('OPEN');
    expect(updated?.finalOutcome).toBe(null);

    db.close();
  });

  it('continues resolving remaining alerts when one market fetch fails', async () => {
    const db = createTestDb();
    runMigrations(db);

    createAlert(db, {
      marketId: 'm-fail',
      question: 'Will fail?',
      spikeAmount: 100,
      baselineAvg: 10,
      multiplier: 10,
      priceYesAtAlert: 0.2,
      priceNoAtAlert: 0.8,
      createdAt: 1_710_000_000,
    });

    const successAlertId = createAlert(db, {
      marketId: 'm-ok',
      question: 'Will pass?',
      spikeAmount: 100,
      baselineAvg: 10,
      multiplier: 10,
      priceYesAtAlert: 0.2,
      priceNoAtAlert: 0.8,
      createdAt: 1_710_000_000,
    });

    const gammaClient = {
      getMarketById: async (marketId: string) => {
        if (marketId === 'm-fail') {
          throw new Error('temporary gamma error');
        }

        return {
          id: marketId,
          closed: true,
          outcome: 'NO',
        };
      },
    };

    const resolved = await resolveOpenAlerts({
      db,
      gammaClient,
      nowSec: 1_710_000_900,
    });

    const updated = getAlertById(db, successAlertId);

    expect(resolved).toBe(1);
    expect(updated?.status).toBe('RESOLVED');
    expect(updated?.finalOutcome).toBe('NO');

    db.close();
  });
});
