export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS volume_history (
  market_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  hourly_volume REAL NOT NULL,
  PRIMARY KEY (market_id, timestamp)
);

CREATE INDEX IF NOT EXISTS idx_volume_history_timestamp
  ON volume_history(timestamp);

CREATE INDEX IF NOT EXISTS idx_volume_history_market
  ON volume_history(market_id);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_id TEXT NOT NULL,
  question TEXT NOT NULL,
  spike_amount REAL NOT NULL,
  baseline_avg REAL NOT NULL,
  multiplier REAL NOT NULL,
  price_yes_at_alert REAL,
  price_no_at_alert REAL,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  final_outcome TEXT,
  pnl_if_yes REAL,
  pnl_if_no REAL,
  status TEXT NOT NULL DEFAULT 'OPEN'
);

CREATE INDEX IF NOT EXISTS idx_alerts_status_created
  ON alerts(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_alerts_market_created
  ON alerts(market_id, created_at DESC);
`;
