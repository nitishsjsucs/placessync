-- Catalog: sites, employees, resources, amenities (SPEC 6.1).
CREATE TABLE sites (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  timezone    TEXT NOT NULL,
  open_min    INTEGER NOT NULL CHECK (open_min BETWEEN 0 AND 1440),
  close_min   INTEGER NOT NULL CHECK (close_min > open_min AND close_min <= 1440),
  horizon_days INTEGER NOT NULL DEFAULT 14 CHECK (horizon_days BETWEEN 1 AND 60)
);

CREATE TABLE employees (
  id           TEXT PRIMARY KEY,                 -- emp_001 .. emp_100
  email        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  department   TEXT NOT NULL,
  role         TEXT NOT NULL CHECK (role IN ('employee','facilities_staff','facilities_admin')),
  home_site_id TEXT NOT NULL REFERENCES sites(id),
  active       INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at   TEXT NOT NULL
);
CREATE INDEX idx_employees_role ON employees(role);

CREATE TABLE resources (
  id          TEXT PRIMARY KEY,                  -- res_2a01 .. ; rooms res_redwood ..
  site_id     TEXT NOT NULL REFERENCES sites(id),
  kind        TEXT NOT NULL CHECK (kind IN ('desk','room')),
  name        TEXT NOT NULL,
  floor       INTEGER NOT NULL,
  zone        TEXT NOT NULL,
  capacity    INTEGER NOT NULL CHECK (capacity >= 1),
  description TEXT NOT NULL DEFAULT '',
  active      INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  UNIQUE (site_id, name)
);
CREATE INDEX idx_resources_site_kind ON resources(site_id, kind, active);

CREATE TABLE amenities (id TEXT PRIMARY KEY, label TEXT NOT NULL);
CREATE TABLE resource_amenities (
  resource_id TEXT NOT NULL REFERENCES resources(id) ON DELETE CASCADE,
  amenity_id  TEXT NOT NULL REFERENCES amenities(id),
  PRIMARY KEY (resource_id, amenity_id)
);
