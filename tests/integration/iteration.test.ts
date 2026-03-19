import { describe, expect, it } from 'vitest';

import { runMigrations } from '../../src/db/migrate';
import {
  createTestDb,
  listColumns,
  listIndexes,
  listTables,
} from '../helpers/testDb';

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
