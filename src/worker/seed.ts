// Dev seed: writes the synthetic world into D1 (and, from the ledger commit on, the
// SiteLedger catalog). Only reachable through /api/dev/seed in dev mode.
import { SEED, generateHistory, generateSeedRequests, generateWorld } from "../shared/synthetic/index.ts";
import { siteToday } from "../shared/time.ts";
import { classifyByKeywords } from "../shared/triage/keyword-classifier.ts";
import { renderRequest } from "../shared/triage/prompt.ts";
import type { Config } from "./config.ts";
import { ledgerFor } from "./ledger/ledger-for.ts";

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

/**
 * 40 demo requests for the dashboards. Their suggestions come from the keyword stub at
 * seed time and are stored as provider 'stub', model 'keyword-v1' (SPEC 11.1): no seeded
 * row ever claims an LLM produced it.
 */
export async function seedRequests(db: D1Database, nowMs: number): Promise<number> {
  const world = generateWorld(SEED);
  const resourceNames = new Map(world.resources.map((r) => [r.id, r.name]));
  const iso = (ms: number) => new Date(ms).toISOString();
  const stmts: D1PreparedStatement[] = [];
  const event = (id: string, type: string, actor: string | null, data: unknown, at: number) =>
    db.prepare("INSERT INTO request_events (request_id, type, actor_id, data, at) VALUES (?, ?, ?, ?, ?)").bind(id, type, actor, JSON.stringify(data), iso(at));
  for (const r of generateSeedRequests(SEED)) {
    const created = nowMs - r.ageMinutes * 60_000;
    const triagedAt = created + 60_000;
    const k = classifyByKeywords(renderRequest({ title: r.title, description: r.description, resourceName: r.resourceId ? (resourceNames.get(r.resourceId) ?? null) : null, locationNote: r.locationNote }));
    const reviewed = r.status === "assigned" || r.status === "in_progress" || r.status === "resolved";
    const reviewedAt = created + Math.floor(r.ageMinutes / 3) * 60_000;
    const decision = reviewed ? (k.category === r.category ? "accepted" : "reassigned") : null;
    const lastChange = r.status === "cancelled" ? created + Math.floor(r.ageMinutes / 2) * 60_000 : reviewed ? reviewedAt + (r.status === "assigned" ? 0 : 20 * 60_000) : triagedAt;
    stmts.push(
      db
        .prepare(
          `INSERT INTO facilities_requests (id, site_id, reporter_id, resource_id, location_note, title, description, status, triage_state, triage_attempts,
             final_category, review_decision, reviewed_by, reviewed_at, workflow_instance_id, created_at, updated_at)
           VALUES (?, 'hq', ?, ?, ?, ?, ?, ?, 'suggested', 1, ?, ?, ?, ?, NULL, ?, ?)`,
        )
        .bind(
          r.id,
          r.reporterId,
          r.resourceId,
          r.locationNote,
          r.title,
          r.description,
          r.status,
          reviewed ? r.category : null,
          decision,
          reviewed ? r.reviewerId : null,
          reviewed ? iso(reviewedAt) : null,
          iso(created),
          iso(lastChange),
        ),
      db
        .prepare(
          `INSERT INTO triage_suggestions (request_id, category, confidence, rationale, provider, model, attempts, latency_ms, created_at)
           VALUES (?, ?, ?, ?, 'stub', 'keyword-v1', 1, 0, ?)`,
        )
        .bind(r.id, k.category, k.confidence, k.rationale, iso(triagedAt)),
      event(r.id, "submitted", r.reporterId, {}, created),
      event(r.id, "triaged", null, { category: k.category, provider: "stub" }, triagedAt),
    );
    if (reviewed) {
      stmts.push(event(r.id, "reviewed", r.reviewerId, { decision: decision === "accepted" ? "accept" : "reassign", category: r.category }, reviewedAt));
      if (r.status !== "assigned") stmts.push(event(r.id, "status_changed", r.reviewerId, { from: "assigned", to: "in_progress" }, reviewedAt + 10 * 60_000));
      if (r.status === "resolved") stmts.push(event(r.id, "status_changed", r.reviewerId, { from: "in_progress", to: "resolved" }, reviewedAt + 20 * 60_000));
    }
    if (r.status === "cancelled") stmts.push(event(r.id, "cancelled", r.reporterId, {}, lastChange));
  }
  await db.batch(stmts);
  return generateSeedRequests(SEED).length;
}

export async function seedDatabase(env: Env, config: Pick<Config, "siteId">, opts: SeedOptions): Promise<SeedResult> {
  const catalog = await seedCatalog(env.DB, { reset: opts.reset });
  const ledger = ledgerFor(env, config, config.siteId);
  if (opts.reset) await ledger.resetForDev();
  await ledger.syncCatalog();
  const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM facilities_requests WHERE id LIKE 'req_seed_%'").first<{ n: number }>();
  const requests = (existing?.n ?? 0) === 0 ? await seedRequests(env.DB, opts.nowMs) : 0;
  let historyReservations = 0;
  if (opts.history) {
    // The 20 business days before today; the ledger's alarm projects them into D1.
    const today = siteToday(generateWorld(SEED).site.timezone, opts.nowMs);
    historyReservations = (await ledger.importHistory(generateHistory(SEED, today))).imported;
  }
  return { ...catalog, historyReservations, requests };
}
