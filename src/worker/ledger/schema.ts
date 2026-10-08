// SiteLedger Durable Object SQLite schema (SPEC 6.2). Applied in the constructor under
// blockConcurrencyWhile and guarded by meta.schema_version.

export const SCHEMA_VERSION = 1;

const DDL = `
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS site (
  id TEXT PRIMARY KEY, timezone TEXT NOT NULL, open_min INTEGER NOT NULL, close_min INTEGER NOT NULL, horizon_days INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, capacity INTEGER NOT NULL, active INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS date_versions (
  date TEXT PRIMARY KEY, version INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL, employee_id TEXT NOT NULL, kind TEXT NOT NULL,
  date TEXT NOT NULL, start_min INTEGER NOT NULL, end_min INTEGER NOT NULL,
  attendees INTEGER NOT NULL DEFAULT 1, title TEXT,
  status TEXT NOT NULL CHECK (status IN ('confirmed','cancelled')),
  created_at INTEGER NOT NULL, cancelled_at INTEGER, cancelled_by TEXT, cancel_reason TEXT,
  version INTEGER NOT NULL,
  CHECK (start_min % 15 = 0 AND end_min % 15 = 0 AND end_min > start_min)
);
CREATE INDEX IF NOT EXISTS idx_rsv_resource_day ON reservations(resource_id, date, status);
CREATE INDEX IF NOT EXISTS idx_rsv_employee_day ON reservations(employee_id, date, status);

CREATE TABLE IF NOT EXISTS resource_slots (
  resource_id TEXT NOT NULL, date TEXT NOT NULL, slot INTEGER NOT NULL, reservation_id TEXT NOT NULL,
  PRIMARY KEY (resource_id, date, slot)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS employee_slots (
  employee_id TEXT NOT NULL, kind TEXT NOT NULL, date TEXT NOT NULL, slot INTEGER NOT NULL, reservation_id TEXT NOT NULL,
  PRIMARY KEY (employee_id, kind, date, slot)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS idempotency (
  employee_id TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL,
  response TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (employee_id, key)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS outbox (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, reservation_id TEXT NOT NULL,
  version INTEGER NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL
);
`;

export const META_DEFAULTS: Record<string, string> = {
  ledger_version: "0",
  backstop_hits: "0",
  flush_failures: "0",
  last_flush_error: "",
  catalog_synced_at: "",
};

/** Data tables cleared by resetForDev; the schema and schema_version stay. */
export const DATA_TABLES = ["site", "resources", "date_versions", "reservations", "resource_slots", "employee_slots", "idempotency", "outbox"];

export function applySchema(sql: SqlStorage): void {
  const current = sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray().length
    ? sql.exec("SELECT value FROM meta WHERE key = 'schema_version'").toArray()[0]?.value
    : undefined;
  if (current !== undefined && Number(current) >= SCHEMA_VERSION) return;
  sql.exec(DDL);
  for (const [key, value] of Object.entries(META_DEFAULTS)) {
    sql.exec("INSERT OR IGNORE INTO meta (key, value) VALUES (?, ?)", key, value);
  }
  sql.exec("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)", String(SCHEMA_VERSION));
}
