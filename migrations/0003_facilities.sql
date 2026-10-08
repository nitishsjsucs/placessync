-- Facilities requests, triage suggestions and the request event log (SPEC 6.1, 7.3).
CREATE TABLE facilities_requests (
  id                   TEXT PRIMARY KEY,         -- req_<ulid>
  site_id              TEXT NOT NULL REFERENCES sites(id),
  reporter_id          TEXT NOT NULL REFERENCES employees(id),
  resource_id          TEXT REFERENCES resources(id),
  location_note        TEXT NOT NULL DEFAULT '',
  title                TEXT NOT NULL CHECK (length(title) BETWEEN 5 AND 120),
  description          TEXT NOT NULL CHECK (length(description) BETWEEN 20 AND 2000),
  status               TEXT NOT NULL CHECK (status IN ('submitted','awaiting_review','assigned','in_progress','resolved','cancelled')),
  triage_state         TEXT NOT NULL DEFAULT 'pending' CHECK (triage_state IN ('pending','suggested','unavailable')),
  triage_attempts      INTEGER NOT NULL DEFAULT 0,   -- workflow create/restart attempts made by the API and the sweep
  final_category       TEXT CHECK (final_category IN ('building_systems','electrical_av','furniture_fixtures','cleaning_safety')),
  review_decision      TEXT CHECK (review_decision IN ('accepted','reassigned','manual')),  -- manual: categorized with no suggestion shown
  reviewed_by          TEXT REFERENCES employees(id),
  reviewed_at          TEXT,
  workflow_instance_id TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);
CREATE INDEX idx_requests_status ON facilities_requests(site_id, status, created_at);
CREATE INDEX idx_requests_reporter ON facilities_requests(reporter_id, created_at);

CREATE TABLE triage_suggestions (
  request_id TEXT PRIMARY KEY REFERENCES facilities_requests(id),
  category   TEXT NOT NULL CHECK (category IN ('building_systems','electrical_av','furniture_fixtures','cleaning_safety')),
  confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  rationale  TEXT NOT NULL,
  provider   TEXT NOT NULL CHECK (provider IN ('workers-ai','openai-compat','stub','keyword-fallback')),
  model      TEXT NOT NULL,
  attempts   INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE request_events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT NOT NULL REFERENCES facilities_requests(id),
  type       TEXT NOT NULL CHECK (type IN ('submitted','triage_started','triage_retry','triaged','triage_unavailable','reviewed','review_observed','review_overdue','status_changed','cancelled')),
  actor_id   TEXT,
  data       TEXT NOT NULL DEFAULT '{}',
  at         TEXT NOT NULL
);
CREATE INDEX idx_request_events_request ON request_events(request_id, id);
CREATE UNIQUE INDEX ux_one_review_event ON request_events(request_id) WHERE type = 'reviewed';

CREATE VIEW v_request_category_summary AS
SELECT site_id, COALESCE(final_category, '(unreviewed)') AS category, status, COUNT(*) AS n
FROM facilities_requests GROUP BY site_id, category, status;

CREATE VIEW v_triage_agreement AS
SELECT s.provider, COUNT(*) AS reviewed,
       SUM(r.final_category = s.category) AS agreed,
       ROUND(1.0 * SUM(r.final_category = s.category) / COUNT(*), 4) AS agreement_rate
FROM facilities_requests r JOIN triage_suggestions s ON s.request_id = r.id
WHERE r.review_decision IN ('accepted','reassigned')   -- 'manual' reviews never saw a suggestion
GROUP BY s.provider;
