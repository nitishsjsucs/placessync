import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { ADMIN } from "../helpers/tokens.ts";
import { as, json, seed } from "../helpers/world.ts";

const DATE = "2026-10-12";

beforeAll(async () => {
  await seed();
  await env.DB.exec("DELETE FROM reservation_facts");
  const fact = (id: string, resource: string, kind: string, start: number, end: number, status: string, version: number) =>
    env.DB.prepare(
      `INSERT INTO reservation_facts (reservation_id, site_id, resource_id, resource_kind, employee_id, date, start_min, end_min, attendees,
         status, created_at, cancelled_at, ledger_version, projected_at)
       VALUES (?, 'hq', ?, ?, 'emp_001', ?, ?, ?, 1, ?, '2026-10-08T00:00:00.000Z', NULL, ?, '2026-10-08T00:00:01.000Z')`,
    ).bind(id, resource, kind, DATE, start, end, status, version);
  await env.DB.batch([
    fact("r1", "res_2a01", "desk", 540, 660, "confirmed", 1),
    fact("r2", "res_2a01", "desk", 720, 840, "confirmed", 2),
    fact("r3", "res_redwood", "room", 600, 630, "confirmed", 3),
    fact("r4", "res_redwood", "room", 660, 720, "cancelled", 5),
  ]);
});

describe("D1 reporting views (SPEC 6.1)", () => {
  it("v_resource_daily_utilization via the admin report", async () => {
    const admin = await as(ADMIN);
    const body = await json<{ rows: unknown[]; totals: Record<string, number> }>(
      await admin.get(`/api/admin/reports/utilization?from=${DATE}&to=${DATE}`),
    );
    // Open hours 07:00 to 19:00 = 720 minutes. res_2a01: 240 / 720; Redwood: 30 / 720.
    expect(body.rows).toEqual([
      { resourceId: "res_2a01", kind: "desk", name: "Desk 2A-01", date: DATE, bookings: 2, bookedMin: 240, utilization: 0.3333 },
      { resourceId: "res_redwood", kind: "room", name: "Redwood", date: DATE, bookings: 1, bookedMin: 30, utilization: 0.0417 },
    ]);
    expect(body.totals).toEqual({ bookings: 3, bookedMin: 270, resourceDays: 2, openMinutesPerDay: 720 });
  });

  it("filters the utilization report by kind", async () => {
    const admin = await as(ADMIN);
    const body = await json<{ rows: { kind: string }[] }>(await admin.get(`/api/admin/reports/utilization?from=${DATE}&to=${DATE}&kind=room`));
    expect(body.rows.map((r) => r.kind)).toEqual(["room"]);
  });

  it("v_hourly_occupancy counts bookings overlapping each hour", async () => {
    const admin = await as(ADMIN);
    const body = await json<{ hourly: { resourceKind: string; hour: number; occupied: number }[] }>(
      await admin.get(`/api/admin/reports/utilization?from=${DATE}&to=${DATE}`),
    );
    const byKey = Object.fromEntries(body.hourly.map((h) => [`${h.resourceKind}:${h.hour}`, h.occupied]));
    expect(byKey).toEqual({ "desk:9": 1, "desk:10": 1, "desk:12": 1, "desk:13": 1, "room:10": 1 });
  });

  it("v_daily_booking_summary splits confirmed and cancelled", async () => {
    const { results } = await env.DB.prepare(
      "SELECT resource_kind, confirmed, cancelled FROM v_daily_booking_summary WHERE site_id = 'hq' AND date = ? ORDER BY resource_kind",
    )
      .bind(DATE)
      .all();
    expect(results).toEqual([
      { resource_kind: "desk", confirmed: 2, cancelled: 0 },
      { resource_kind: "room", confirmed: 1, cancelled: 1 },
    ]);
  });

  it("raw facts for a day via /api/admin/reports/reservations", async () => {
    const admin = await as(ADMIN);
    const body = await json<{ facts: { reservationId: string }[] }>(await admin.get(`/api/admin/reports/reservations?date=${DATE}`));
    expect(body.facts.map((f) => f.reservationId)).toEqual(["r1", "r2", "r3", "r4"]);
  });
});
