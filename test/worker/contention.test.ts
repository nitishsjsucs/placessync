import { runDurableObjectAlarm } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { Reservation } from "../../src/shared/api.ts";
import { countOverlappingPairsBy, overlaps } from "../../src/shared/intervals.ts";
import { type AttemptOutcome, fireAttempts } from "../helpers/contention.ts";
import { hqLedger, seed } from "../helpers/world.ts";

// SPEC 12.1: the 1,000 generated attempts (both dates), fired concurrently through the
// Worker with real tokens for the 100 employees.
let outcomes: AttemptOutcome[];
let dates: { A: string; B: string };
let ledger: Reservation[];

beforeAll(async () => {
  await seed();
  ({ outcomes, dates } = await fireAttempts());
  ledger = [...(await hqLedger().exportDay(dates.A)), ...(await hqLedger().exportDay(dates.B))];
}, 120_000);

describe("1,000 concurrent reservation attempts", () => {
  it("every request answered 201 or 409; no validation errors and no 5xx", () => {
    expect(outcomes).toHaveLength(1000);
    const statuses = new Set(outcomes.map((o) => o.status));
    expect([...statuses].sort()).toEqual([201, 409]);
    expect(outcomes.filter((o) => o.status === 422)).toHaveLength(0);
    expect(outcomes.filter((o) => o.status >= 500)).toHaveLength(0);
  });

  it("0 overlapping confirmed pairs per resource and date", () => {
    expect(countOverlappingPairsBy(ledger, (r) => `${r.resourceId}|${r.date}`)).toBe(0);
  });

  it("0 employee double-desk or double-room pairs", () => {
    expect(countOverlappingPairsBy(ledger, (r) => `${r.employeeId}|${r.kind}|${r.date}`)).toBe(0);
  });

  it("every 201 is in the ledger and every ledger row got a 201", () => {
    const accepted = outcomes.filter((o) => o.status === 201).map((o) => (o.body.reservation as Reservation).id).sort();
    expect(ledger.map((r) => r.id).sort()).toEqual(accepted);
    expect(accepted.length).toBeGreaterThan(0);
  });

  it("every 409 conflicts with at least one confirmed booking (no unjustified rejections)", () => {
    const unjustified = outcomes
      .filter((o) => o.status === 409)
      .filter((o) => {
        const want = { startMin: o.attempt.startMin, endMin: o.attempt.endMin };
        if (o.body.error === "resource_conflict") {
          return !ledger.some((r) => r.resourceId === o.attempt.resourceId && r.date === o.date && overlaps(r, want));
        }
        if (o.body.error === "employee_conflict") {
          return !ledger.some((r) => r.employeeId === o.attempt.employeeId && r.kind === o.attempt.kind && r.date === o.date && overlaps(r, want));
        }
        return true;
      });
    expect(unjustified).toEqual([]);
  });

  it("date_versions equal the 201 count per date", async () => {
    const versions = await hqLedger().dateVersions();
    const acceptedOn = (d: string) => outcomes.filter((o) => o.status === 201 && o.date === d).length;
    expect(versions[dates.A]).toBe(acceptedOn(dates.A));
    expect(versions[dates.B]).toBe(acceptedOn(dates.B));
  });

  it("the D1 projection equals the ledger after draining the alarm", async () => {
    const stub = hqLedger();
    for (let i = 0; i < 100 && (await stub.projectionStatus()).outboxDepth > 0; i++) await runDurableObjectAlarm(stub);
    expect((await stub.projectionStatus()).outboxDepth).toBe(0);
    const { results } = await env.DB.prepare(
      "SELECT reservation_id AS id, resource_id AS resourceId, employee_id AS employeeId, date, start_min AS startMin, end_min AS endMin FROM reservation_facts WHERE status = 'confirmed' AND date IN (?, ?) ORDER BY reservation_id",
    )
      .bind(dates.A, dates.B)
      .all();
    expect(results).toEqual(
      ledger
        .map((r) => ({ id: r.id, resourceId: r.resourceId, employeeId: r.employeeId, date: r.date, startMin: r.startMin, endMin: r.endMin }))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
  });

  it("the PK backstop never fired", async () => {
    expect((await hqLedger().projectionStatus()).backstopHits).toBe(0);
  });
});
