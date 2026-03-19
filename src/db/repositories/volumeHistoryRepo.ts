import type { SQLiteDatabase } from '../client';

export interface VolumeHistoryPoint {
  marketId: string;
  timestamp: number;
  hourlyVolume: number;
}

export interface BaselineSnapshot {
  average: number;
  points: number;
}

export function upsertVolumeHistory(
  db: SQLiteDatabase,
  point: VolumeHistoryPoint
): void {
  db.prepare(
    `
      INSERT INTO volume_history (market_id, timestamp, hourly_volume)
      VALUES (?, ?, ?)
      ON CONFLICT(market_id, timestamp)
      DO UPDATE SET hourly_volume = excluded.hourly_volume
    `
  ).run(point.marketId, point.timestamp, point.hourlyVolume);
}

export function getBaselineSnapshot(
  db: SQLiteDatabase,
  marketId: string,
  fromTimestamp: number,
  toTimestamp: number
): BaselineSnapshot {
  const row = db
    .prepare(
      `
        SELECT
          AVG(hourly_volume) AS average,
          COUNT(*) AS points
        FROM volume_history
        WHERE market_id = ?
          AND timestamp >= ?
          AND timestamp < ?
      `
    )
    .get(marketId, fromTimestamp, toTimestamp) as
    | { average: number | null; points: number }
    | undefined;

  return {
    average: row?.average ?? 0,
    points: row?.points ?? 0,
  };
}

export function getVolumeHistory(
  db: SQLiteDatabase,
  marketId: string,
  fromTimestamp?: number,
  toTimestamp?: number
): Array<{ timestamp: number; hourlyVolume: number }> {
  const clauses = ['market_id = ?'];
  const params: Array<string | number> = [marketId];

  if (typeof fromTimestamp === 'number') {
    clauses.push('timestamp >= ?');
    params.push(fromTimestamp);
  }

  if (typeof toTimestamp === 'number') {
    clauses.push('timestamp <= ?');
    params.push(toTimestamp);
  }

  return db
    .prepare(
      `
        SELECT timestamp, hourly_volume AS hourlyVolume
        FROM volume_history
        WHERE ${clauses.join(' AND ')}
        ORDER BY timestamp ASC
      `
    )
    .all(...params) as Array<{ timestamp: number; hourlyVolume: number }>;
}
