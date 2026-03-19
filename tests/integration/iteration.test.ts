import { describe, expect, it } from 'vitest';
import { createTestDb, listTables } from '../helpers/testDb';
import { runMigrations } from '../../src/db/migrate';

describe('database initialization', () => {
  it('creates required tables', () => {
    const db = createTestDb();

    runMigrations(db);

    expect(listTables(db)).toContain('volume_history');
    expect(listTables(db)).toContain('alerts');

    db.close();
  });
});
