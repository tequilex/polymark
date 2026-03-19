import Database from 'better-sqlite3';

import type { SQLiteDatabase } from '../../src/db/client';

export function createTestDb(): SQLiteDatabase {
  return new Database(':memory:');
}

export function listTables(db: SQLiteDatabase): string[] {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all() as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

export function listIndexes(db: SQLiteDatabase, tableName: string): string[] {
  const rows = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? AND name NOT LIKE 'sqlite_autoindex%' ORDER BY name"
    )
    .all(tableName) as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

export function listColumns(db: SQLiteDatabase, tableName: string): string[] {
  const rows = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all() as Array<{ name: string }>;

  return rows.map((row) => row.name);
}
