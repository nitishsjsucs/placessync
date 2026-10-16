// GET /api/staff/bookings and the spaces it lists for the staff day timeline (VIZ-02).
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN, EMPLOYEE, STAFF } from "../helpers/tokens.ts";
import { as, bizDay, hqLedger, json, seed } from "../helpers/world.ts";

interface Body {
  date: string;
  bookings: { id: string; resourceId: string }[];
  resources?: Record<string, unknown>[];
}

beforeAll(async () => {
  await seed();
});
beforeEach(async () => {
  await hqLedger().resetForDev();
});

describe("staff bookings lists the day's spaces (VIZ-02)", () => {
  it("lists every active space, plus an inactive one only when it is booked that day, with no employee data", async () => {
    const date = bizDay(3);
    const ledger = hqLedger();
    await ledger.reserve({ employeeId: EMPLOYEE, role: "employee" }, { resourceId: "res_3b03", date, startMin: 540, endMin: 600 }, "sb-1");
    await ledger.reserve({ employeeId: EMPLOYEE, role: "employee" }, { resourceId: "res_alder", date, startMin: 600, endMin: 660, attendees: 3, title: "Sync" }, "sb-2");
    const admin = await as(ADMIN);
    // Booked, then deactivated: still listed for that day. Not booked and inactive: left out.
    for (const id of ["res_3b03", "res_3b02"]) await (await admin.patch(`/api/admin/resources/${id}`, { active: false })).body?.cancel();
    try {
      const res = await (await as(STAFF)).get(`/api/staff/bookings?date=${date}`);
      expect(res.status).toBe(200);
      const body = await json<Body>(res);
      expect(body.bookings.map((b) => b.resourceId).sort()).toEqual(["res_3b03", "res_alder"]);
      const resources = body.resources ?? [];
      expect(resources).toHaveLength(19);
      expect(resources.find((r) => r.id === "res_3b03")).toEqual({ id: "res_3b03", name: "Desk 3B-03", kind: "desk", active: false });
      expect(resources.some((r) => r.id === "res_3b02")).toBe(false);
      expect(resources.filter((r) => r.active === false)).toHaveLength(1);
      for (const r of resources) expect(Object.keys(r).sort()).toEqual(["active", "id", "kind", "name"]);
      // Admins see the same list.
      const asAdmin = await json<Body>(await admin.get(`/api/staff/bookings?date=${date}`));
      expect(asAdmin.resources).toEqual(resources);
    } finally {
      for (const id of ["res_3b03", "res_3b02"]) await (await admin.patch(`/api/admin/resources/${id}`, { active: true })).body?.cancel();
    }
  });

  it("an empty day still lists all 20 active spaces", async () => {
    const body = await json<Body>(await (await as(STAFF)).get(`/api/staff/bookings?date=${bizDay(4)}`));
    expect(body.bookings).toEqual([]);
    expect(body.resources?.map((r) => r.kind).filter((k) => k === "room")).toHaveLength(6);
    expect(body.resources).toHaveLength(20);
  });

  it("still refuses employees", async () => {
    const res = await (await as(EMPLOYEE)).get(`/api/staff/bookings?date=${bizDay(3)}`);
    expect(res.status).toBe(403);
    await res.body?.cancel();
  });
});
