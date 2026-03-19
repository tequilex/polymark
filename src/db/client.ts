import BetterSqlite3 from 'better-sqlite3';

export type SQLiteDatabase = BetterSqlite3.Database;

export function createDatabase(dbPath: string): SQLiteDatabase {
  return new BetterSqlite3(dbPath);
}
