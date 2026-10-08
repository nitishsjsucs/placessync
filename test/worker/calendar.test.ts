import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { addDays, weekStartOf } from "../../src/shared/time.ts";
import { EMPLOYEE, EMPLOYEE_2 } from "../helpers/tokens.ts";
import { as, bizDay, hqLedger, json, seed } from "../helpers/world.ts";

type Day = { date: string; busy: { startMin: number; endMin: number; mine: boolean; reservationId?: string }[] };

beforeAll(async () => {
  await seed();
});
beforeEach(async () => {
  await hqLedger().resetForDev();
});

describe("GET /api/resources/:resourceId/calendar", () => {
  it("returns 7 days from the Monday with mine flags and only the viewer's ids", async () => {
    const d1 = bizDay(5);
    const week = weekStartOf(d1);
    const mine = await hqLedger().reserve({ employeeId: EMPLOYEE, role: "employee" }, { resourceId: "res_sequoia", date: d1, startMin: 540, endMin: 600 }, "cal-1");
    await hqLedger().reserve({ employeeId: EMPLOYEE_2, role: "employee" }, { resourceId: "res_sequoia", date: d1, startMin: 600, endMin: 660 }, "cal-2");
    const user = await as(EMPLOYEE);
    const res = await user.get(`/api/resources/res_sequoia/calendar?weekStart=${week}`);
    expect(res.status).toBe(200);
    const raw = await res.text();
    const body = JSON.parse(raw) as { resource: { id: string }; days: Day[] };
    expect(body.resource.id).toBe("res_sequoia");
    expect(body.days.map((d) => d.date)).toEqual(Array.from({ length: 7 }, (_, i) => addDays(week, i)));
    const day = body.days.find((d) => d.date === d1);
    expect(day?.busy).toEqual([
      { startMin: 540, endMin: 600, mine: true, reservationId: mine.ok ? mine.reservation.id : "x" },
      { startMin: 600, endMin: 660, mine: false },
    ]);
    // Never another employee's id, in any field.
    expect(raw).not.toContain(EMPLOYEE_2);
    expect(raw).not.toContain(EMPLOYEE);
  });

  it("rejects a weekStart that is not a Monday", async () => {
    const user = await as(EMPLOYEE);
    const res = await user.get(`/api/resources/res_sequoia/calendar?weekStart=${addDays(weekStartOf(bizDay(5)), 1)}`);
    expect(res.status).toBe(422);
    await res.body?.cancel();
  });

  it("returns 404 resource_not_found for an unknown resource", async () => {
    const user = await as(EMPLOYEE);
    const res = await user.get(`/api/resources/res_nope/calendar?weekStart=${weekStartOf(bizDay(5))}`);
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("resource_not_found");
  });
});
