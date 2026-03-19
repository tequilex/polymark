import type { SQLiteDatabase } from './client';
import { SCHEMA_SQL } from './schema';

export function runMigrations(db: SQLiteDatabase): void {
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA_SQL);
}
