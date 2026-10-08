import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { SEED, generateHistory } from "../../src/shared/synthetic/index.ts";
import { previousBusinessDays, siteToday } from "../../src/shared/time.ts";
import { ADMIN } from "../helpers/tokens.ts";
import { TZ, as, hqLedger, json, seed } from "../helpers/world.ts";

let result: Record<string, number>;
const today = siteToday(TZ, Date.now());

beforeAll(async () => {
  result = await seed({ reset: true, history: true });
  const stub = hqLedger();
  for (let i = 0; i < 100 && (await stub.projectionStatus()).outboxDepth > 0; i++) await runDurableObjectAlarm(stub);
}, 120_000);

describe("history import (SPEC 11.1, Tier 2)", () => {
  it("imports every generated past booking through the ledger", () => {
    expect(result.historyReservations).toBe(generateHistory(SEED, today).length);
    expect(result.historyReservations).toBeGreaterThan(0);
  });

  it("projects the history into D1 reporting", async () => {
    const days = previousBusinessDays(today, 20);
    const row = await env.DB.prepare("SELECT COUNT(*) AS n, SUM(status = 'cancelled') AS c FROM reservation_facts WHERE date BETWEEN ? AND ?")
      .bind(days[0], days[19])
      .first<{ n: number; c: number }>();
    const generated = generateHistory(SEED, today);
    expect(row?.n).toBe(generated.length);
    expect(row?.c).toBe(generated.filter((h) => h.cancelled).length);
    const admin = await as(ADMIN);
    const report = await json<{ rows: unknown[]; hourly: unknown[]; daily: { confirmed: number; cancelled: number }[] }>(
      await admin.get(`/api/admin/reports/utilization?from=${days[0]}&to=${days[19]}`),
    );
    expect(report.rows.length).toBeGreaterThan(0);
    expect(report.hourly.length).toBeGreaterThan(0);
    expect(report.daily.reduce((n, d) => n + d.confirmed + d.cancelled, 0)).toBe(generated.length);
  });

  it("still enforces overlap and slot rules on imported rows", async () => {
    const day = previousBusinessDays(today, 1)[0] as string;
    const stub = hqLedger();
    const first = await stub.importHistory([{ employeeId: "emp_005", resourceId: "res_cypress", kind: "room", date: day, startMin: 1080, endMin: 1110, attendees: 1, cancelled: false }]);
    const clash = await stub.importHistory([
      { employeeId: "emp_006", resourceId: "res_cypress", kind: "room", date: day, startMin: 1095, endMin: 1125, attendees: 1, cancelled: false },
      { employeeId: "emp_007", resourceId: "res_cypress", kind: "room", date: "2026-10-10", startMin: 600, endMin: 630, attendees: 1, cancelled: false },
    ]);
    expect(first).toEqual({ imported: 1, rejected: 0 });
    // An overlap on the same room, and a weekend date, are both rejected.
    expect(clash).toEqual({ imported: 0, rejected: 2 });
  });
});
