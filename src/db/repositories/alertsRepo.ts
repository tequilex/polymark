import type { SQLiteDatabase } from '../client';

export type AlertStatus = 'OPEN' | 'RESOLVED' | 'ERROR';
export type AlertOutcome = 'YES' | 'NO' | 'UNRESOLVED' | null;

export interface AlertRow {
  id: number;
  marketId: string;
  question: string;
  spikeAmount: number;
  baselineAvg: number;
  multiplier: number;
  priceYesAtAlert: number | null;
  priceNoAtAlert: number | null;
  createdAt: number;
  resolvedAt: number | null;
  finalOutcome: AlertOutcome;
  pnlIfYes: number | null;
  pnlIfNo: number | null;
  status: AlertStatus;
}

export interface CreateAlertInput {
  marketId: string;
  question: string;
  spikeAmount: number;
  baselineAvg: number;
  multiplier: number;
  priceYesAtAlert: number | null;
  priceNoAtAlert: number | null;
  createdAt: number;
}

function mapAlertRow(row: Record<string, unknown>): AlertRow {
  return {
    id: Number(row.id),
    marketId: String(row.market_id),
    question: String(row.question),
    spikeAmount: Number(row.spike_amount),
    baselineAvg: Number(row.baseline_avg),
    multiplier: Number(row.multiplier),
    priceYesAtAlert:
      row.price_yes_at_alert === null ? null : Number(row.price_yes_at_alert),
    priceNoAtAlert:
      row.price_no_at_alert === null ? null : Number(row.price_no_at_alert),
    createdAt: Number(row.created_at),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at),
    finalOutcome: (row.final_outcome as AlertOutcome) ?? null,
    pnlIfYes: row.pnl_if_yes === null ? null : Number(row.pnl_if_yes),
    pnlIfNo: row.pnl_if_no === null ? null : Number(row.pnl_if_no),
    status: String(row.status) as AlertStatus,
  };
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 50;
  }

  const normalized = Math.floor(value);
  if (normalized <= 0) {
    return 1;
  }

  return Math.min(normalized, 200);
}

function clampOffset(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.floor(value));
}

export function createAlert(db: SQLiteDatabase, input: CreateAlertInput): number {
  const result = db
    .prepare(
      `
        INSERT INTO alerts (
          market_id,
          question,
          spike_amount,
          baseline_avg,
          multiplier,
          price_yes_at_alert,
          price_no_at_alert,
          created_at,
          status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'OPEN')
      `
    )
    .run(
      input.marketId,
      input.question,
      input.spikeAmount,
      input.baselineAvg,
      input.multiplier,
      input.priceYesAtAlert,
      input.priceNoAtAlert,
      input.createdAt
    );

  return Number(result.lastInsertRowid);
}

export function getLastAlertCreatedAt(
  db: SQLiteDatabase,
  marketId: string
): number | null {
  const row = db
    .prepare(
      `
        SELECT created_at
        FROM alerts
        WHERE market_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `
    )
    .get(marketId) as { created_at: number } | undefined;

  return row?.created_at ?? null;
}

export interface ListAlertsFilters {
  status?: AlertStatus;
  marketId?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
}

export function listAlerts(
  db: SQLiteDatabase,
  filters: ListAlertsFilters = {}
): AlertRow[] {
  const clauses: string[] = [];
  const params: Array<string | number> = [];

  if (filters.status) {
    clauses.push('status = ?');
    params.push(filters.status);
  }

  if (filters.marketId) {
    clauses.push('market_id = ?');
    params.push(filters.marketId);
  }

  if (typeof filters.from === 'number') {
    clauses.push('created_at >= ?');
    params.push(filters.from);
  }

  if (typeof filters.to === 'number') {
    clauses.push('created_at <= ?');
    params.push(filters.to);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  const limit = clampLimit(filters.limit);
  const offset = clampOffset(filters.offset);

  const rows = db
    .prepare(
      `
        SELECT *
        FROM alerts
        ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT ?
        OFFSET ?
      `
    )
    .all(...params, limit, offset) as Record<string, unknown>[];

  return rows.map(mapAlertRow);
}

export function getAlertById(
  db: SQLiteDatabase,
  id: number
): AlertRow | null {
  const row = db
    .prepare('SELECT * FROM alerts WHERE id = ? LIMIT 1')
    .get(id) as Record<string, unknown> | undefined;

  return row ? mapAlertRow(row) : null;
}

export function listOpenAlerts(db: SQLiteDatabase): AlertRow[] {
  const rows = db
    .prepare("SELECT * FROM alerts WHERE status = 'OPEN' ORDER BY created_at ASC")
    .all() as Record<string, unknown>[];

  return rows.map(mapAlertRow);
}

export interface ResolveAlertInput {
  id: number;
  resolvedAt: number;
  finalOutcome: Exclude<AlertOutcome, null>;
  pnlIfYes: number | null;
  pnlIfNo: number | null;
  status?: Extract<AlertStatus, 'RESOLVED' | 'ERROR'>;
}

export function resolveAlert(db: SQLiteDatabase, input: ResolveAlertInput): void {
  db.prepare(
    `
      UPDATE alerts
      SET resolved_at = ?,
          final_outcome = ?,
          pnl_if_yes = ?,
          pnl_if_no = ?,
          status = ?
      WHERE id = ?
    `
  ).run(
    input.resolvedAt,
    input.finalOutcome,
    input.pnlIfYes,
    input.pnlIfNo,
    input.status ?? 'RESOLVED',
    input.id
  );
}
