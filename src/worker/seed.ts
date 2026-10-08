// Dev seed: writes the synthetic world into D1 (and, from the ledger commit on, the
// SiteLedger catalog). Only reachable through /api/dev/seed in dev mode.
import { SEED, generateWorld } from "../shared/synthetic/index.ts";

export interface SeedOptions {
  reset: boolean;
  history: boolean;
  nowMs: number;
}

export interface SeedResult {
  employees: number;
  resources: number;
  historyReservations: number;
  requests: number;
}

const RESET_ORDER = [
  "request_events",
  "triage_suggestions",
  "facilities_requests",
  "reservation_facts",
  "projection_state",
  "resource_amenities",
  "resources",
  "amenities",
  "employees",
  "sites",
];

export async function seedCatalog(db: D1Database, opts: { reset: boolean }): Promise<{ employees: number; resources: number }> {
  const world = generateWorld(SEED);
  const stmts: D1PreparedStatement[] = [];
  if (opts.reset) for (const t of RESET_ORDER) stmts.push(db.prepare(`DELETE FROM ${t}`));
  const s = world.site;
  stmts.push(
    db
      .prepare(
        `INSERT INTO sites (id, name, timezone, open_min, close_min, horizon_days) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, timezone = excluded.timezone, open_min = excluded.open_min,
           close_min = excluded.close_min, horizon_days = excluded.horizon_days`,
      )
      .bind(s.id, s.name, s.timezone, s.openMin, s.closeMin, s.horizonDays),
  );
  for (const a of world.amenities) {
    stmts.push(
      db.prepare("INSERT INTO amenities (id, label) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label").bind(a.id, a.label),
    );
  }
  for (const r of world.resources) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO resources (id, site_id, kind, name, floor, zone, capacity, description, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET site_id = excluded.site_id, kind = excluded.kind, name = excluded.name, floor = excluded.floor,
             zone = excluded.zone, capacity = excluded.capacity, description = excluded.description, active = excluded.active`,
        )
        .bind(r.id, r.siteId, r.kind, r.name, r.floor, r.zone, r.capacity, r.description, r.active ? 1 : 0),
    );
    stmts.push(db.prepare("DELETE FROM resource_amenities WHERE resource_id = ?").bind(r.id));
    for (const a of r.amenities) {
      stmts.push(db.prepare("INSERT INTO resource_amenities (resource_id, amenity_id) VALUES (?, ?)").bind(r.id, a));
    }
  }
  for (const e of world.employees) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO employees (id, email, display_name, department, role, home_site_id, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, department = excluded.department,
             role = excluded.role, home_site_id = excluded.home_site_id, active = excluded.active`,
        )
        .bind(e.id, e.email, e.displayName, e.department, e.role, e.homeSiteId, e.active ? 1 : 0, e.createdAt),
    );
  }
  await db.batch(stmts);
  return { employees: world.employees.length, resources: world.resources.length };
}

export async function seedDatabase(env: Env, opts: SeedOptions): Promise<SeedResult> {
  const catalog = await seedCatalog(env.DB, { reset: opts.reset });
  return { ...catalog, historyReservations: 0, requests: 0 };
}
