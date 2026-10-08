import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN, EMPLOYEE, STAFF } from "../helpers/tokens.ts";
import { as, bizDay, hqLedger, json, seed } from "../helpers/world.ts";

beforeAll(async () => {
  await seed();
});
beforeEach(async () => {
  await hqLedger().resetForDev();
});

describe("admin resource edits (Tier 2)", () => {
  it("deactivating a resource updates D1 and the ledger at once; reactivating restores booking", async () => {
    const admin = await as(ADMIN);
    const user = await as(EMPLOYEE);
    const off = await admin.patch("/api/admin/resources/res_3b03", { active: false });
    expect(off.status).toBe(200);
    expect((await json<{ resource: { active: boolean } }>(off)).resource.active).toBe(false);
    const blocked = await user.post("/api/reservations", { resourceId: "res_3b03", date: bizDay(2), startMin: 540, endMin: 660 }, { "Idempotency-Key": "adm-res-1" });
    expect(blocked.status).toBe(422);
    expect((await json<{ issues: { code: string }[] }>(blocked)).issues.map((i) => i.code)).toContain("inactive_resource");
    const list = await json<{ resources: { id: string }[] }>(await user.get("/api/sites/hq/resources"));
    expect(list.resources.map((r) => r.id)).not.toContain("res_3b03");
    const all = await json<{ resources: { id: string }[] }>(await admin.get("/api/sites/hq/resources?includeInactive=1"));
    expect(all.resources.map((r) => r.id)).toContain("res_3b03");
    await (await admin.patch("/api/admin/resources/res_3b03", { active: true })).body?.cancel();
    const ok = await user.post("/api/reservations", { resourceId: "res_3b03", date: bizDay(2), startMin: 540, endMin: 660 }, { "Idempotency-Key": "adm-res-2" });
    expect(ok.status).toBe(201);
    await ok.body?.cancel();
  });

  it("changes a room's capacity for the booking rules, and refuses desk capacity above 1", async () => {
    const admin = await as(ADMIN);
    await (await admin.patch("/api/admin/resources/res_cypress", { capacity: 3, description: "Phone booth for three." })).body?.cancel();
    const row = await env.DB.prepare("SELECT capacity, description FROM resources WHERE id = 'res_cypress'").first();
    expect(row).toEqual({ capacity: 3, description: "Phone booth for three." });
    const r = await hqLedger().reserve({ employeeId: EMPLOYEE, role: "employee" }, { resourceId: "res_cypress", date: bizDay(2), startMin: 540, endMin: 600, attendees: 3 }, "cap-1");
    expect(r.ok).toBe(true);
    const desk = await admin.patch("/api/admin/resources/res_2a01", { capacity: 4 });
    expect(desk.status).toBe(422);
    await desk.body?.cancel();
    await (await admin.patch("/api/admin/resources/res_cypress", { capacity: 2, description: "Meeting room for up to 2 on floor 2, south side." })).body?.cancel();
  });

  it("rejects empty bodies and unknown resources", async () => {
    const admin = await as(ADMIN);
    const empty = await admin.patch("/api/admin/resources/res_cypress", {});
    expect(empty.status).toBe(422);
    await empty.body?.cancel();
    const missing = await admin.patch("/api/admin/resources/res_nope", { active: false });
    expect(missing.status).toBe(404);
    await missing.body?.cancel();
  });
});

describe("staff today's bookings (Tier 2)", () => {
  it("lists a day's bookings with employee names for staff", async () => {
    const date = bizDay(2);
    await hqLedger().reserve({ employeeId: EMPLOYEE, role: "employee" }, { resourceId: "res_alder", date, startMin: 600, endMin: 660, attendees: 4, title: "Planning" }, "tb-1");
    const staff = await as(STAFF);
    const body = await json<{ bookings: { resourceName: string; employeeName: string; title: string | null }[] }>(await staff.get(`/api/staff/bookings?date=${date}`));
    expect(body.bookings).toHaveLength(1);
    expect(body.bookings[0]).toMatchObject({ resourceName: "Alder", title: "Planning" });
    expect(body.bookings[0]?.employeeName).toMatch(/\w+ \w+/);
  });
});
