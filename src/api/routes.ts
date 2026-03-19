import type { FastifyInstance } from 'fastify';

import type { SQLiteDatabase } from '../db/client';
import {
  getAlertById,
  listAlerts,
  type AlertStatus,
} from '../db/repositories/alertsRepo';
import { getVolumeHistory } from '../db/repositories/volumeHistoryRepo';
import type { AppHealth } from '../types';

export interface ApiRoutesContext {
  db: SQLiteDatabase;
  getHealth: () => AppHealth;
}

interface SummaryStatsRow {
  open_alerts: number | null;
  resolved_alerts: number | null;
  avg_multiplier_24h: number | null;
  max_spike_24h: number | null;
}

interface ErrorPayload {
  error: {
    code: string;
    message: string;
    details: Record<string, unknown>;
  };
}

function errorPayload(
  code: string,
  message: string,
  details: Record<string, unknown>
): ErrorPayload {
  return {
    error: {
      code,
      message,
      details,
    },
  };
}

function parseOptionalInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  return Math.floor(parsed);
}

function parseAlertStatus(value: unknown): AlertStatus | undefined {
  const normalized = String(value ?? '').toUpperCase();

  if (normalized === '') {
    return undefined;
  }

  if (normalized === 'OPEN' || normalized === 'RESOLVED' || normalized === 'ERROR') {
    return normalized;
  }

  return undefined;
}

function getSummaryStats(db: SQLiteDatabase, nowSec: number): {
  openAlerts: number;
  resolvedAlerts: number;
  avgMultiplier24h: number;
  maxSpike24h: number;
} {
  const from24h = nowSec - 24 * 3600;

  const row = db
    .prepare(
      `
        SELECT
          SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END) AS open_alerts,
          SUM(CASE WHEN status = 'RESOLVED' THEN 1 ELSE 0 END) AS resolved_alerts,
          AVG(CASE WHEN created_at >= ? THEN multiplier END) AS avg_multiplier_24h,
          MAX(CASE WHEN created_at >= ? THEN spike_amount END) AS max_spike_24h
        FROM alerts
      `
    )
    .get(from24h, from24h) as SummaryStatsRow | undefined;

  return {
    openAlerts: Number(row?.open_alerts ?? 0),
    resolvedAlerts: Number(row?.resolved_alerts ?? 0),
    avgMultiplier24h: Number(row?.avg_multiplier_24h ?? 0),
    maxSpike24h: Number(row?.max_spike_24h ?? 0),
  };
}

export function registerApiRoutes(
  app: FastifyInstance,
  context: ApiRoutesContext
): void {
  app.get('/api/health', async () => context.getHealth());

  app.get('/api/alerts', async (request, reply) => {
    const query = request.query as Record<string, unknown>;

    const statusRaw = query.status;
    const status = parseAlertStatus(statusRaw);
    if (statusRaw !== undefined && status === undefined) {
      reply.status(400);
      return errorPayload('VALIDATION_ERROR', 'Invalid status value', {
        field: 'status',
      });
    }

    const marketId =
      typeof query.market_id === 'string'
        ? query.market_id
        : typeof query.marketId === 'string'
          ? query.marketId
          : undefined;

    return {
      items: listAlerts(context.db, {
        status,
        marketId,
        from: parseOptionalInt(query.from),
        to: parseOptionalInt(query.to),
        limit: parseOptionalInt(query.limit),
        offset: parseOptionalInt(query.offset),
      }),
    };
  });

  app.get('/api/alerts/:id', async (request, reply) => {
    const params = request.params as { id?: string };
    const id = Number(params.id);

    if (!Number.isInteger(id) || id <= 0) {
      reply.status(400);
      return errorPayload('VALIDATION_ERROR', 'Invalid alert id', {
        field: 'id',
      });
    }

    const alert = getAlertById(context.db, id);
    if (!alert) {
      reply.status(404);
      return errorPayload('NOT_FOUND', 'Alert not found', {
        resource: 'alert',
      });
    }

    return alert;
  });

  app.get('/api/markets/:id/volume', async (request) => {
    const params = request.params as { id?: string };
    const query = request.query as Record<string, unknown>;

    const marketId = String(params.id ?? '');
    const from = parseOptionalInt(query.from);
    const to = parseOptionalInt(query.to);

    return getVolumeHistory(context.db, marketId, from, to);
  });

  app.get('/api/stats/summary', async () => {
    const nowSec = Math.floor(Date.now() / 1000);

    return getSummaryStats(context.db, nowSec);
  });
}
