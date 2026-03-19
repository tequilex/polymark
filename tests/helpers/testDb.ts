import Database from 'better-sqlite3';

import type { SQLiteDatabase } from '../../src/db/client';

export function createTestDb(): SQLiteDatabase {
  return new Database(':memory:');
}

export function listTables(db: SQLiteDatabase): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((row: { name: string }) => row.name);
}
