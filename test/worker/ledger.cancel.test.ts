import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SiteLedger } from "../../src/worker/ledger/site-ledger.ts";
import { ADMIN, EMPLOYEE, EMPLOYEE_2, STAFF } from "../helpers/tokens.ts";
import { bizDay, hqLedger, seed, siteInstant } from "../helpers/world.ts";

const emp = { employeeId: EMPLOYEE, role: "employee" as const };
const emp2 = { employeeId: EMPLOYEE_2, role: "employee" as const };
const staff = { employeeId: STAFF, role: "facilities_staff" as const };
const admin = { employeeId: ADMIN, role: "facilities_admin" as const };
let n = 0;
const k = () => `cancel-${++n}`;

beforeAll(async () => {
  await seed();
});
beforeEach(async () => {
  await hqLedger().resetForDev();
});
afterEach(async () => {
  await runInDurableObject(hqLedger(), (i: SiteLedger) => {
    i.clockOverride = undefined;
  });
});

async function book(actor = emp, resourceId = "res_2a01", date = bizDay(2)) {
  const r = await hqLedger().reserve(actor, { resourceId, date, startMin: 540, endMin: 660 }, k());
  if (!r.ok) throw new Error(`booking failed: ${JSON.stringify(r)}`);
  return r.reservation;
}

describe("SiteLedger.cancel", () => {
  it("lets the owner cancel and frees the slots for a rebook", async () => {
    const r = await book();
    const c = await hqLedger().cancel(emp, r.id, "plans changed");
    expect(c).toMatchObject({ ok: true, status: 200, reservation: { status: "cancelled", cancelledBy: EMPLOYEE, cancelReason: "plans changed" } });
    const again = await hqLedger().reserve(emp2, { resourceId: "res_2a01", date: r.date, startMin: 540, endMin: 660 }, k());
    expect(again.ok).toBe(true);
    // The owner's employee slots were freed as well.
    const own = await hqLedger().reserve(emp, { resourceId: "res_2a02", date: r.date, startMin: 540, endMin: 660 }, k());
    expect(own.ok).toBe(true);
  });

  it("lets a facilities admin cancel anyone's booking", async () => {
    const r = await book();
    expect(await hqLedger().cancel(admin, r.id)).toMatchObject({ ok: true, reservation: { cancelledBy: ADMIN } });
  });

  it("refuses a non-owner employee and facilities staff with not_owner", async () => {
    const r = await book();
    expect(await hqLedger().cancel(emp2, r.id)).toEqual({ ok: false, status: 403, error: "not_owner" });
    expect(await hqLedger().cancel(staff, r.id)).toEqual({ ok: false, status: 403, error: "not_owner" });
  });

  it("refuses a booking that has already started", async () => {
    const r = await book();
    await runInDurableObject(hqLedger(), (i: SiteLedger) => {
      i.clockOverride = () => siteInstant(r.date, 600);
    });
    expect(await hqLedger().cancel(emp, r.id)).toEqual({ ok: false, status: 409, error: "already_started" });
  });

  it("refuses a double cancel with not_confirmed", async () => {
    const r = await book();
    await hqLedger().cancel(emp, r.id);
    expect(await hqLedger().cancel(emp, r.id)).toEqual({ ok: false, status: 409, error: "not_confirmed" });
  });

  it("returns reservation_not_found for an unknown id", async () => {
    expect(await hqLedger().cancel(emp, "rsv_nope")).toEqual({ ok: false, status: 404, error: "reservation_not_found" });
  });

  it("bumps date_versions for the cancelled date only", async () => {
    const a = bizDay(2);
    const b = bizDay(3);
    const r = await book(emp, "res_2a01", a);
    await book(emp, "res_2a01", b);
    const before = await hqLedger().dateVersions();
    const c = await hqLedger().cancel(emp, r.id);
    expect(c.ok && c.dateVersion).toBe((before[a] ?? 0) + 1);
    expect(await hqLedger().dateVersions()).toEqual({ ...before, [a]: (before[a] ?? 0) + 1 });
    expect((await hqLedger().ledgerStats()).ledgerVersion).toBe(3);
  });
});
