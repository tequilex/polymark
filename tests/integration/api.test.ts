import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildServer } from '../../src/api/server';
import { createAlert } from '../../src/db/repositories/alertsRepo';
import { upsertVolumeHistory } from '../../src/db/repositories/volumeHistoryRepo';
import { runMigrations } from '../../src/db/migrate';
import type { AppHealth } from '../../src/types';
import { createTestDb } from '../helpers/testDb';

describe('api', () => {
  const health: AppHealth = {
    status: 'ok',
    lastSuccessfulIterationAt: 1_710_000_000,
    iterationErrors24h: 1,
    db: 'ok',
  };

  let db: ReturnType<typeof createTestDb>;
  let app: ReturnType<typeof buildServer>;
  let alertId = 0;

  beforeEach(() => {
    db = createTestDb();
    runMigrations(db);

    app = buildServer({
      db,
      getHealth: () => health,
    });

    alertId = createAlert(db, {
      marketId: 'm-1',
      question: 'Will X happen?',
      spikeAmount: 500,
      baselineAvg: 100,
      multiplier: 6,
      priceYesAtAlert: 0.6,
      priceNoAtAlert: 0.4,
      createdAt: Math.floor(Date.now() / 1000),
    });

    createAlert(db, {
      marketId: 'm-2',
      question: 'Will Y happen?',
      spikeAmount: 400,
      baselineAvg: 80,
      multiplier: 5,
      priceYesAtAlert: 0.55,
      priceNoAtAlert: 0.45,
      createdAt: Math.floor(Date.now() / 1000),
    });

    upsertVolumeHistory(db, {
      marketId: 'm-1',
      timestamp: 1_710_000_000,
      hourlyVolume: 610,
    });
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('returns health payload', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(health);
  });

  it('returns alerts list with market_id filter and pagination', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/alerts?market_id=m-1&limit=10&offset=0',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      items: Array<{ id: number; marketId: string }>;
    };

    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]?.id).toBe(alertId);
    expect(payload.items[0]?.marketId).toBe('m-1');
  });

  it('returns alert details by id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/api/alerts/${alertId}`,
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as { id: number; marketId: string };
    expect(payload.id).toBe(alertId);
    expect(payload.marketId).toBe('m-1');
  });

  it('returns market volume history as array', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/markets/m-1/volume?from=1710000000&to=1710000000',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as Array<{ timestamp: number }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.timestamp).toBe(1_710_000_000);
  });

  it('returns summary stats', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/stats/summary',
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      openAlerts: number;
      resolvedAlerts: number;
      avgMultiplier24h: number;
      maxSpike24h: number;
    };

    expect(payload.openAlerts).toBeGreaterThan(0);
    expect(payload.resolvedAlerts).toBe(0);
    expect(payload.avgMultiplier24h).toBeGreaterThan(0);
    expect(payload.maxSpike24h).toBeGreaterThan(0);
  });

  it('returns validation error envelope for invalid alert id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/alerts/abc',
    });

    expect(response.statusCode).toBe(400);
    const payload = response.json() as {
      error: { code: string; message: string; details: Record<string, unknown> };
    };
    expect(payload.error.code).toBe('VALIDATION_ERROR');
    expect(payload.error.details).toEqual({ field: 'id' });
  });

  it('returns not found envelope for absent alert', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/alerts/999999',
    });

    expect(response.statusCode).toBe(404);
    const payload = response.json() as {
      error: { code: string; message: string; details: Record<string, unknown> };
    };
    expect(payload.error.code).toBe('NOT_FOUND');
    expect(payload.error.details).toEqual({ resource: 'alert' });
  });
});
