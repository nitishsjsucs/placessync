-- Reporting models fed by the SiteLedger outbox (SPEC 6.1, ADR 0003).
CREATE TABLE reservation_facts (
  reservation_id TEXT PRIMARY KEY,
  site_id        TEXT NOT NULL,
  resource_id    TEXT NOT NULL,
  resource_kind  TEXT NOT NULL CHECK (resource_kind IN ('desk','room')),
  employee_id    TEXT NOT NULL,
  date           TEXT NOT NULL,                  -- site-local YYYY-MM-DD
  start_min      INTEGER NOT NULL,
  end_min        INTEGER NOT NULL,
  attendees      INTEGER NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('confirmed','cancelled')),
  created_at     TEXT NOT NULL,
  cancelled_at   TEXT,
  ledger_version INTEGER NOT NULL,
  projected_at   TEXT NOT NULL
);
CREATE INDEX idx_facts_site_date ON reservation_facts(site_id, date, status);
CREATE INDEX idx_facts_resource_date ON reservation_facts(resource_id, date);
CREATE INDEX idx_facts_employee_date ON reservation_facts(employee_id, date);

CREATE TABLE projection_state (
  site_id            TEXT PRIMARY KEY,
  max_ledger_version INTEGER NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE report_hours (hour INTEGER PRIMARY KEY);
INSERT INTO report_hours (hour) VALUES (7),(8),(9),(10),(11),(12),(13),(14),(15),(16),(17),(18);

CREATE VIEW v_resource_daily_utilization AS
SELECT f.site_id, f.resource_id, r.kind, r.name, f.date,
       COUNT(*)                         AS bookings,
       SUM(f.end_min - f.start_min)     AS booked_min,
       ROUND(1.0 * SUM(f.end_min - f.start_min) / (s.close_min - s.open_min), 4) AS utilization
FROM reservation_facts f
JOIN resources r ON r.id = f.resource_id
JOIN sites s     ON s.id = f.site_id
WHERE f.status = 'confirmed'
GROUP BY f.site_id, f.resource_id, f.date;

CREATE VIEW v_hourly_occupancy AS
SELECT f.site_id, f.date, f.resource_kind, h.hour, COUNT(*) AS occupied
FROM reservation_facts f
JOIN report_hours h ON f.start_min < (h.hour + 1) * 60 AND f.end_min > h.hour * 60
WHERE f.status = 'confirmed'
GROUP BY f.site_id, f.date, f.resource_kind, h.hour;

CREATE VIEW v_daily_booking_summary AS
SELECT site_id, date, resource_kind,
       SUM(status = 'confirmed') AS confirmed,
       SUM(status = 'cancelled') AS cancelled
FROM reservation_facts
GROUP BY site_id, date, resource_kind;
