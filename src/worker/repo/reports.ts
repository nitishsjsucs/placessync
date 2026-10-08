// Reporting reads over the D1 projection (SPEC 6.1 views).

export interface UtilizationRow {
  resourceId: string;
  kind: "desk" | "room";
  name: string;
  date: string;
  bookings: number;
  bookedMin: number;
  utilization: number;
}

export interface HourlyRow {
  date: string;
  resourceKind: "desk" | "room";
  hour: number;
  occupied: number;
}

export async function utilizationReport(db: D1Database, siteId: string, from: string, to: string, kind?: "desk" | "room") {
  const kindClause = kind ? " AND kind = ?" : "";
  const binds: unknown[] = [siteId, from, to, ...(kind ? [kind] : [])];
  const { results: rows } = await db
    .prepare(
      `SELECT resource_id AS resourceId, kind, name, date, bookings, booked_min AS bookedMin, utilization
       FROM v_resource_daily_utilization WHERE site_id = ? AND date BETWEEN ? AND ?${kindClause}
       ORDER BY date, kind, name`,
    )
    .bind(...binds)
    .all<UtilizationRow>();
  const { results: hourly } = await db
    .prepare(
      `SELECT date, resource_kind AS resourceKind, hour, occupied FROM v_hourly_occupancy
       WHERE site_id = ? AND date BETWEEN ? AND ?${kind ? " AND resource_kind = ?" : ""} ORDER BY date, resource_kind, hour`,
    )
    .bind(...binds)
    .all<HourlyRow>();
  const site = await db.prepare("SELECT close_min - open_min AS openMinutes FROM sites WHERE id = ?").bind(siteId).first<{ openMinutes: number }>();
  const totals = {
    bookings: rows.reduce((n, r) => n + r.bookings, 0),
    bookedMin: rows.reduce((n, r) => n + r.bookedMin, 0),
    resourceDays: rows.length,
    openMinutesPerDay: site?.openMinutes ?? 0,
  };
  return { from, to, kind: kind ?? null, rows, hourly, totals };
}

export interface FactRow {
  reservationId: string;
  siteId: string;
  resourceId: string;
  resourceKind: "desk" | "room";
  employeeId: string;
  date: string;
  startMin: number;
  endMin: number;
  attendees: number;
  status: "confirmed" | "cancelled";
  createdAt: string;
  cancelledAt: string | null;
  ledgerVersion: number;
  projectedAt: string;
}

export async function reservationFacts(db: D1Database, siteId: string, date: string): Promise<FactRow[]> {
  const { results } = await db
    .prepare(
      `SELECT reservation_id AS reservationId, site_id AS siteId, resource_id AS resourceId, resource_kind AS resourceKind,
              employee_id AS employeeId, date, start_min AS startMin, end_min AS endMin, attendees, status,
              created_at AS createdAt, cancelled_at AS cancelledAt, ledger_version AS ledgerVersion, projected_at AS projectedAt
       FROM reservation_facts WHERE site_id = ? AND date = ? ORDER BY resource_id, start_min`,
    )
    .bind(siteId, date)
    .all<FactRow>();
  return results;
}

export async function projectionState(db: D1Database, siteId: string) {
  return db
    .prepare("SELECT max_ledger_version AS maxLedgerVersion, updated_at AS updatedAt FROM projection_state WHERE site_id = ?")
    .bind(siteId)
    .first<{ maxLedgerVersion: number; updatedAt: string }>();
}

export async function requestsReport(db: D1Database, siteId: string, from: string, to: string) {
  const range = [siteId, `${from}T00:00:00.000Z`, `${to}T23:59:59.999Z`];
  const { results: categories } = await db
    .prepare(
      `SELECT COALESCE(final_category, '(unreviewed)') AS category, status, COUNT(*) AS n FROM facilities_requests
       WHERE site_id = ? AND created_at BETWEEN ? AND ? GROUP BY category, status ORDER BY category, status`,
    )
    .bind(...range)
    .all<{ category: string; status: string; n: number }>();
  // Agreement is always per provider (SPEC 6.1); nothing aggregates across providers.
  const { results: agreement } = await db
    .prepare(
      `SELECT s.provider, COUNT(*) AS reviewed, SUM(r.final_category = s.category) AS agreed,
              ROUND(1.0 * SUM(r.final_category = s.category) / COUNT(*), 4) AS agreementRate
       FROM facilities_requests r JOIN triage_suggestions s ON s.request_id = r.id
       WHERE r.review_decision IN ('accepted','reassigned') AND r.site_id = ? AND r.created_at BETWEEN ? AND ?
       GROUP BY s.provider ORDER BY s.provider`,
    )
    .bind(...range)
    .all<{ provider: string; reviewed: number; agreed: number; agreementRate: number }>();
  const { results: reviewed } = await db
    .prepare("SELECT created_at AS createdAt, reviewed_at AS reviewedAt FROM facilities_requests WHERE site_id = ? AND created_at BETWEEN ? AND ? AND reviewed_at IS NOT NULL")
    .bind(...range)
    .all<{ createdAt: string; reviewedAt: string }>();
  const minutes = reviewed.map((r) => (Date.parse(r.reviewedAt) - Date.parse(r.createdAt)) / 60_000).sort((a, b) => a - b);
  return { from, to, categories, agreement, medianMinutesToReview: median(minutes), reviewedCount: minutes.length };
}

export function median(sorted: readonly number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
  return Math.round(value * 10) / 10;
}
