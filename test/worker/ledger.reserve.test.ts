import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN, EMPLOYEE, EMPLOYEE_2 } from "../helpers/tokens.ts";
import { bizDay, hqLedger, seed } from "../helpers/world.ts";

const emp = { employeeId: EMPLOYEE, role: "employee" as const };
const emp2 = { employeeId: EMPLOYEE_2, role: "employee" as const };
let key = 0;
const k = () => `key-${++key}-${Date.now()}`;

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
    expect(over.ok).toBe(false);
    if (!over.ok && over.error === "validation") expect(over.issues.map((i) => i.code)).toContain("over_capacity");
    const ok = await hqLedger().reserve(emp, { resourceId: "res_cypress", date, startMin: 540, endMin: 600, attendees: 2, title: "1:1" }, k());
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.reservation.title).toBe("1:1");
  });

  it("rejects an inactive resource", async () => {
    await env.DB.prepare("UPDATE resources SET active = 0 WHERE id = 'res_3b03'").run();
    await hqLedger().syncCatalog();
    const r = await hqLedger().reserve(emp, { resourceId: "res_3b03", date: bizDay(2), startMin: 540, endMin: 660 }, k());
    await env.DB.prepare("UPDATE resources SET active = 1 WHERE id = 'res_3b03'").run();
    await hqLedger().syncCatalog();
    expect(r.ok).toBe(false);
    if (!r.ok && r.error === "validation") expect(r.issues.map((i) => i.code)).toContain("inactive_resource");
  });

  it("returns resource_not_found for an id outside the catalog", async () => {
    const r = await hqLedger().reserve(emp, { resourceId: "res_nope", date: bizDay(2), startMin: 540, endMin: 660 }, k());
    expect(r).toEqual({ ok: false, status: 404, error: "resource_not_found" });
  });

  it("applies the booking rules from the ledger site row", async () => {
    const r = await hqLedger().reserve(emp, { resourceId: "res_2a01", date: bizDay(2), startMin: 1080, endMin: 1200 }, k());
    expect(r.ok).toBe(false);
    if (!r.ok && r.error === "validation") expect(r.issues.map((i) => i.code)).toContain("after_close");
  });

  it("exports confirmed reservations for a day", async () => {
    const date = bizDay(4);
    await hqLedger().reserve(emp, { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, k());
    await hqLedger().reserve({ employeeId: ADMIN, role: "facilities_admin" }, { resourceId: "res_alder", date, startMin: 540, endMin: 600 }, k());
    const rows = await hqLedger().exportDay(date);
    expect(rows.map((r) => r.resourceId)).toEqual(["res_2a01", "res_alder"]);
  });
});
