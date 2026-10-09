import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN, EMPLOYEE, EMPLOYEE_2 } from "../helpers/tokens.ts";
import { bizDay, hqLedger, seed } from "../helpers/world.ts";

const emp = { employeeId: EMPLOYEE, role: "employee" as const };
const emp2 = { employeeId: EMPLOYEE_2, role: "employee" as const };
let key = 0;
const k = () => `key-${++key}-${Date.now()}`;
const issueCodes = (r: { ok: boolean }) => ("issues" in r ? (r.issues as { code: string }[]).map((i) => i.code) : []);

beforeAll(async () => {
  await seed();
});
beforeEach(async () => {
  await hqLedger().resetForDev();
});

describe("SiteLedger.reserve", () => {
  it("confirms a valid desk booking with the full reservation shape", async () => {
    const date = bizDay(2);
    const r = await hqLedger().reserve(emp, { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, k());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.status).toBe(201);
    expect(r.reservation).toMatchObject({
      resourceId: "res_2a01",
      employeeId: EMPLOYEE,
      kind: "desk",
      date,
      startMin: 540,
      endMin: 660,
      attendees: 1,
      title: null,
      status: "confirmed",
      cancelledAt: null,
    });
    expect(r.reservation.id).toMatch(/^rsv_[0-9a-z]{26}$/);
    expect(r.ledgerVersion).toBe(1);
  });

  it("rejects an overlapping booking and lists the conflicting interval", async () => {
    const date = bizDay(2);
    await hqLedger().reserve(emp, { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, k());
    const r = await hqLedger().reserve(emp2, { resourceId: "res_2a01", date, startMin: 600, endMin: 720 }, k());
    expect(r).toEqual({ ok: false, status: 409, error: "resource_conflict", conflicts: [{ startMin: 540, endMin: 660 }] });
  });

  it("allows adjacent bookings (end == start)", async () => {
    const date = bizDay(2);
    const a = await hqLedger().reserve(emp, { resourceId: "res_2a01", date, startMin: 540, endMin: 600 }, k());
    const b = await hqLedger().reserve(emp2, { resourceId: "res_2a01", date, startMin: 600, endMin: 660 }, k());
    expect(a.ok && b.ok).toBe(true);
  });

  it("does not conflict across dates or resources", async () => {
    const r1 = await hqLedger().reserve(emp, { resourceId: "res_2a01", date: bizDay(2), startMin: 540, endMin: 660 }, k());
    const r2 = await hqLedger().reserve(emp2, { resourceId: "res_2a01", date: bizDay(3), startMin: 540, endMin: 660 }, k());
    const r3 = await hqLedger().reserve(emp2, { resourceId: "res_2a02", date: bizDay(2), startMin: 540, endMin: 660 }, k());
    expect([r1.ok, r2.ok, r3.ok]).toEqual([true, true, true]);
  });

  it("enforces room capacity", async () => {
    const date = bizDay(2);
    const over = await hqLedger().reserve(emp, { resourceId: "res_cypress", date, startMin: 540, endMin: 600, attendees: 3 }, k());
    expect(over).toMatchObject({ ok: false, status: 422, error: "validation" });
    expect(issueCodes(over)).toEqual(["over_capacity"]);
    const ok = await hqLedger().reserve(emp, { resourceId: "res_cypress", date, startMin: 540, endMin: 600, attendees: 2, title: "1:1" }, k());
    expect(ok).toMatchObject({ ok: true, status: 201, reservation: { title: "1:1", attendees: 2 } });
  });

  it("rejects an inactive resource", async () => {
    await env.DB.prepare("UPDATE resources SET active = 0 WHERE id = 'res_3b03'").run();
    await hqLedger().syncCatalog();
    const r = await hqLedger().reserve(emp, { resourceId: "res_3b03", date: bizDay(2), startMin: 540, endMin: 660 }, k());
    await env.DB.prepare("UPDATE resources SET active = 1 WHERE id = 'res_3b03'").run();
    await hqLedger().syncCatalog();
    expect(r).toMatchObject({ ok: false, status: 422, error: "validation" });
    expect(issueCodes(r)).toEqual(["inactive_resource"]);
  });

  it("returns resource_not_found for an id outside the catalog", async () => {
    const r = await hqLedger().reserve(emp, { resourceId: "res_nope", date: bizDay(2), startMin: 540, endMin: 660 }, k());
    expect(r).toEqual({ ok: false, status: 404, error: "resource_not_found" });
  });

  it("applies the booking rules from the ledger site row, synced from D1", async () => {
    const r = await hqLedger().reserve(emp, { resourceId: "res_2a01", date: bizDay(2), startMin: 1080, endMin: 1200 }, k());
    expect(r).toMatchObject({ ok: false, status: 422, error: "validation" });
    expect(issueCodes(r)).toEqual(["after_close"]);
    // 17:00 to 18:00 is inside the seeded 07:00 to 19:00 hours. Close the site at 17:00
    // in D1 and resync: the same booking now fails, so the rules read the synced row.
    const evening = { resourceId: "res_2a02", date: bizDay(2), startMin: 1020, endMin: 1080 };
    await env.DB.prepare("UPDATE sites SET close_min = 1020 WHERE id = 'hq'").run();
    try {
      await hqLedger().syncCatalog();
      const closed = await hqLedger().reserve(emp2, evening, k());
      expect(closed).toMatchObject({ ok: false, status: 422, error: "validation" });
      expect(issueCodes(closed)).toEqual(["after_close"]);
    } finally {
      await env.DB.prepare("UPDATE sites SET close_min = 1140 WHERE id = 'hq'").run();
      await hqLedger().syncCatalog();
    }
    expect(await hqLedger().reserve(emp2, evening, k())).toMatchObject({ ok: true, status: 201 });
  });

  it("exports confirmed reservations for a day", async () => {
    const date = bizDay(4);
    await hqLedger().reserve(emp, { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, k());
    await hqLedger().reserve({ employeeId: ADMIN, role: "facilities_admin" }, { resourceId: "res_alder", date, startMin: 540, endMin: 600 }, k());
    const rows = await hqLedger().exportDay(date);
    expect(rows.map((r) => r.resourceId)).toEqual(["res_2a01", "res_alder"]);
  });

  it("rejects a second desk for the same employee at an overlapping time", async () => {
    const date = bizDay(2);
    await hqLedger().reserve(emp, { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, k());
    const r = await hqLedger().reserve(emp, { resourceId: "res_2a02", date, startMin: 600, endMin: 720 }, k());
    expect(r).toEqual({ ok: false, status: 409, error: "employee_conflict", conflicts: [{ startMin: 540, endMin: 660 }] });
  });

  it("rejects a second room for the same organizer at an overlapping time", async () => {
    const date = bizDay(2);
    await hqLedger().reserve(emp, { resourceId: "res_redwood", date, startMin: 540, endMin: 600 }, k());
    const r = await hqLedger().reserve(emp, { resourceId: "res_juniper", date, startMin: 570, endMin: 630 }, k());
    expect(r).toMatchObject({ ok: false, status: 409, error: "employee_conflict" });
  });

  it("allows a desk and a room to overlap for the same employee", async () => {
    const date = bizDay(2);
    const desk = await hqLedger().reserve(emp, { resourceId: "res_2a01", date, startMin: 540, endMin: 720 }, k());
    const room = await hqLedger().reserve(emp, { resourceId: "res_redwood", date, startMin: 600, endMin: 660 }, k());
    expect([desk.ok, room.ok]).toEqual([true, true]);
  });

  it("replays an idempotent request with the identical body and no new row", async () => {
    const date = bizDay(2);
    const input = { resourceId: "res_2a03", date, startMin: 540, endMin: 660 };
    const first = await hqLedger().reserve(emp, input, "same-key-1");
    const second = await hqLedger().reserve(emp, input, "same-key-1");
    expect(second).toEqual(first);
    expect(await hqLedger().exportDay(date)).toHaveLength(1);
    expect((await hqLedger().ledgerStats()).ledgerVersion).toBe(1);
  });

  it("replays a stored conflict for the same key", async () => {
    const date = bizDay(2);
    await hqLedger().reserve(emp2, { resourceId: "res_2a03", date, startMin: 540, endMin: 660 }, k());
    const input = { resourceId: "res_2a03", date, startMin: 600, endMin: 660 };
    const first = await hqLedger().reserve(emp, input, "conflict-key");
    expect(first).toMatchObject({ error: "resource_conflict" });
    expect(await hqLedger().reserve(emp, input, "conflict-key")).toEqual(first);
  });

  it("rejects the same key with a different body as idempotency_key_reuse", async () => {
    const date = bizDay(2);
    await hqLedger().reserve(emp, { resourceId: "res_2a03", date, startMin: 540, endMin: 660 }, "reuse-key");
    const r = await hqLedger().reserve(emp, { resourceId: "res_2a03", date, startMin: 720, endMin: 780 }, "reuse-key");
    expect(r).toEqual({ ok: false, status: 422, error: "idempotency_key_reuse" });
  });

  it("scopes idempotency keys per employee", async () => {
    const date = bizDay(2);
    const a = await hqLedger().reserve(emp, { resourceId: "res_2a03", date, startMin: 540, endMin: 660 }, "shared-key");
    const b = await hqLedger().reserve(emp2, { resourceId: "res_2a04", date, startMin: 540, endMin: 660 }, "shared-key");
    expect([a.ok, b.ok]).toEqual([true, true]);
  });

  it("bumps the per-date version only for the booked date", async () => {
    const a = bizDay(2);
    const b = bizDay(3);
    const r1 = await hqLedger().reserve(emp, { resourceId: "res_2a01", date: a, startMin: 540, endMin: 660 }, k());
    const r2 = await hqLedger().reserve(emp2, { resourceId: "res_2a02", date: a, startMin: 540, endMin: 660 }, k());
    const r3 = await hqLedger().reserve(emp, { resourceId: "res_2a01", date: b, startMin: 540, endMin: 660 }, k());
    expect([r1, r2, r3].map((r) => (r.ok ? [r.ledgerVersion, r.dateVersion] : null))).toEqual([
      [1, 1],
      [2, 2],
      [3, 1],
    ]);
    expect(await hqLedger().dateVersions()).toEqual({ [a]: 2, [b]: 1 });
    expect((await hqLedger().availability(bizDay(4))).dateVersion).toBe(0);
  });
});

