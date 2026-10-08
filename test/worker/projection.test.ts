import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SiteLedger } from "../../src/worker/ledger/site-ledger.ts";
import { EMPLOYEE, EMPLOYEE_2 } from "../helpers/tokens.ts";
import { bizDay, hqLedger, seed } from "../helpers/world.ts";

const emp = { employeeId: EMPLOYEE, role: "employee" as const };
const emp2 = { employeeId: EMPLOYEE_2, role: "employee" as const };
let n = 0;
const k = () => `proj-${++n}`;

beforeAll(async () => {
  await seed();
});
beforeEach(async () => {
  await hqLedger().resetForDev();
  await env.DB.exec("DELETE FROM reservation_facts");
  await env.DB.exec("DELETE FROM projection_state");
});

async function d1Facts(date: string) {
  const { results } = await env.DB.prepare(
    "SELECT reservation_id, resource_id, resource_kind, employee_id, date, start_min, end_min, attendees, status, ledger_version FROM reservation_facts WHERE date = ? ORDER BY reservation_id",
  )
    .bind(date)
    .all();
  return results;
}

async function ledgerRows(date: string) {
  return runInDurableObject(hqLedger(), (_i: SiteLedger, state) =>
    state.storage.sql
      .exec(
        "SELECT id AS reservation_id, resource_id, kind AS resource_kind, employee_id, date, start_min, end_min, attendees, status, version AS ledger_version FROM reservations WHERE date = ? ORDER BY id",
        date,
      )
      .toArray(),
  );
}

async function mutate(date: string) {
  const stub = hqLedger();
  const a = await stub.reserve(emp, { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, k());
  await stub.reserve(emp2, { resourceId: "res_2a02", date, startMin: 540, endMin: 660 }, k());
  await stub.reserve(emp, { resourceId: "res_sequoia", date, startMin: 600, endMin: 660, attendees: 4 }, k());
  if (!a.ok) throw new Error("setup booking failed");
  await stub.cancel(emp, a.reservation.id);
  return a.reservation.id;
}

describe("outbox projection to D1 (SPEC 7.1, ADR 0003)", () => {
  it("writes exactly one outbox row per committed mutation", async () => {
    await mutate(bizDay(2));
    // A conflict commits nothing to the outbox.
    await hqLedger().reserve(emp2, { resourceId: "res_2a02", date: bizDay(2), startMin: 600, endMin: 660 }, k());
    expect((await hqLedger().projectionStatus()).outboxDepth).toBe(4);
  });

  it("drains through the alarm; D1 equals the ledger field by field", async () => {
    const date = bizDay(2);
    await mutate(date);
    await runDurableObjectAlarm(hqLedger());
    const status = await hqLedger().projectionStatus();
    expect(status.outboxDepth).toBe(0);
    expect(status.flushFailures).toBe(0);
    expect(await d1Facts(date)).toEqual(await ledgerRows(date));
    const state = await env.DB.prepare("SELECT max_ledger_version FROM projection_state WHERE site_id = 'hq'").first();
    expect(state?.max_ledger_version).toBe(4);
  });

  it("replaying a flush changes nothing, and an older version never overwrites a newer one", async () => {
    const date = bizDay(2);
    const cancelledId = await mutate(date);
    const payloads = await runInDurableObject(hqLedger(), (_i: SiteLedger, state) =>
      state.storage.sql.exec("SELECT reservation_id, version, payload, created_at FROM outbox ORDER BY seq").toArray(),
    );
    await runDurableObjectAlarm(hqLedger());
    const once = await d1Facts(date);
    // Re-enqueue every payload in reverse order: the "confirmed" fact for the cancelled
    // booking (older version) now arrives after the "cancelled" one.
    await runInDurableObject(hqLedger(), (_i: SiteLedger, state) => {
      for (const p of payloads.slice().reverse()) {
        state.storage.sql.exec("INSERT INTO outbox (reservation_id, version, payload, created_at) VALUES (?, ?, ?, ?)", p.reservation_id, p.version, p.payload, p.created_at);
      }
    });
    await runDurableObjectAlarm(hqLedger());
    expect(await d1Facts(date)).toEqual(once);
    const cancelled = (await d1Facts(date)).find((r) => r.reservation_id === cancelledId);
    expect(cancelled?.status).toBe("cancelled");
  });

  it("backs off with its own failure counter while D1 fails, keeps rows, then drains", async () => {
    const date = bizDay(3);
    await env.DB.exec("ALTER TABLE reservation_facts RENAME TO rf_off");
    try {
      await mutate(date);
      const stub = hqLedger();
      await runDurableObjectAlarm(stub);
      let status = await stub.projectionStatus();
      expect(status.lastFlushError).toContain("no such table");
      expect(status.flushFailures).toBe(1);
      expect(status.outboxDepth).toBe(4);
      let next = await runInDurableObject(stub, (_i: SiteLedger, state) => state.storage.getAlarm());
      expect((next ?? 0) - Date.now()).toBeGreaterThan(1500);
      expect((next ?? 0) - Date.now()).toBeLessThanOrEqual(2000);

      await runDurableObjectAlarm(stub);
      status = await stub.projectionStatus();
      expect(status.flushFailures).toBe(2);
      expect(status.outboxDepth).toBe(4);
      next = await runInDurableObject(stub, (_i: SiteLedger, state) => state.storage.getAlarm());
      expect((next ?? 0) - Date.now()).toBeGreaterThan(3500);
      expect((next ?? 0) - Date.now()).toBeLessThanOrEqual(4000);
    } finally {
      await env.DB.exec("ALTER TABLE rf_off RENAME TO reservation_facts");
    }
    await runDurableObjectAlarm(hqLedger());
    const status = await hqLedger().projectionStatus();
    expect(status).toMatchObject({ outboxDepth: 0, flushFailures: 0, lastFlushError: null });
    expect(await d1Facts(date)).toEqual(await ledgerRows(date));
  });

  it("re-arms the alarm in the constructor after eviction when the outbox is non-empty", async () => {
    const stub = hqLedger();
    await mutate(bizDay(4));
    await runInDurableObject(stub, (_i: SiteLedger, state) => state.storage.deleteAlarm());
    expect(await runInDurableObject(stub, (_i: SiteLedger, state) => state.storage.getAlarm())).toBeNull();
    await evictDurableObject(stub);
    // No alarm exists now, so only the new instance's constructor can drain the outbox.
    const deadline = Date.now() + 5000;
    let depth = (await stub.projectionStatus()).outboxDepth;
    while (depth > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
      depth = (await stub.projectionStatus()).outboxDepth;
    }
    expect(depth).toBe(0);
    expect((await d1Facts(bizDay(4))).length).toBe(3);
  });
});
