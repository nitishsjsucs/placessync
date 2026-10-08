import { beforeAll, describe, expect, it } from "vitest";
import { countOverlappingPairs, countOverlappingPairsBy } from "../../src/shared/intervals.ts";
import { fireAttempts } from "../helpers/contention.ts";
import { ADMIN } from "../helpers/tokens.ts";
import { as, bizDay, json, seed } from "../helpers/world.ts";

beforeAll(async () => {
  await seed();
});

describe("overlap detector sensitivity (SPEC 12.1)", () => {
  it("finds planted overlaps exactly", () => {
    const planted = [
      { startMin: 540, endMin: 600 },
      { startMin: 570, endMin: 630 }, // overlaps the first
      { startMin: 600, endMin: 660 }, // overlaps the second only (adjacent to the first)
      { startMin: 900, endMin: 960 },
      { startMin: 900, endMin: 960 }, // identical: overlaps
    ];
    expect(countOverlappingPairs(planted)).toBe(3);
  });

  it("reports 0 on adjacent intervals", () => {
    const adjacent = Array.from({ length: 12 }, (_, i) => ({ startMin: 420 + i * 60, endMin: 480 + i * 60 }));
    expect(countOverlappingPairs(adjacent)).toBe(0);
  });

  it("the naive read-then-write D1 control, fed the same 1,000 attempts, produces overlaps", async () => {
    const admin = await as(ADMIN);
    const reset = await admin.post("/api/dev/naive/reset");
    expect(reset.status).toBe(200);
    await reset.body?.cancel();
    const { outcomes, dates } = await fireAttempts("/api/dev/naive/reserve");
    expect(outcomes.filter((o) => o.status >= 500)).toHaveLength(0);
    const rows = [
      ...(await json<{ reservations: { resourceId: string; date: string; startMin: number; endMin: number }[] }>(await admin.get(`/api/dev/naive/export?date=${dates.A}`))).reservations,
      ...(await json<{ reservations: { resourceId: string; date: string; startMin: number; endMin: number }[] }>(await admin.get(`/api/dev/naive/export?date=${dates.B}`))).reservations,
    ];
    expect(rows.length).toBe(outcomes.filter((o) => o.status === 201).length);
    expect(countOverlappingPairsBy(rows, (r) => `${r.resourceId}|${r.date}`)).toBeGreaterThan(0);
  }, 120_000);

  it("a resent naive attempt (same Idempotency-Key) adds no second row, so it cannot overlap itself", async () => {
    const admin = await as(ADMIN);
    await (await admin.post("/api/dev/naive/reset")).body?.cancel();
    const date = bizDay(2);
    const body = { resourceId: "res_2a01", date, startMin: 600, endMin: 660, attendees: 1 };
    // Concurrent sends of one attempt: the read can race, but the key-derived id cannot.
    const sends = await Promise.all([1, 2, 3].map(() => admin.post("/api/dev/naive/reserve", body, { "Idempotency-Key": "att_resend_1" })));
    const statuses = sends.map((r) => r.status).sort();
    await Promise.all(sends.map((r) => r.body?.cancel()));
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s !== 201).every((s) => s === 409)).toBe(true);
    const rows = (await json<{ reservations: { id: string; startMin: number; endMin: number }[] }>(await admin.get(`/api/dev/naive/export?date=${date}`))).reservations;
    expect(rows.map((r) => r.id)).toEqual(["naive_att_resend_1"]);
    expect(countOverlappingPairs(rows)).toBe(0);
    // A different attempt sent after the first committed is refused by the read; only
    // concurrent different attempts slip past it (the race the control exists to show).
    const other = await admin.post("/api/dev/naive/reserve", body, { "Idempotency-Key": "att_resend_2" });
    expect(other.status).toBe(409);
    await other.body?.cancel();
  });
});
