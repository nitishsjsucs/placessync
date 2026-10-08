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
