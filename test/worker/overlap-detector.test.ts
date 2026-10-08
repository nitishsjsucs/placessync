import { beforeAll, describe, expect, it } from "vitest";
import { countOverlappingPairs, countOverlappingPairsBy } from "../../src/shared/intervals.ts";
import { fireAttempts } from "../helpers/contention.ts";
import { ADMIN } from "../helpers/tokens.ts";
import { as, json, seed } from "../helpers/world.ts";

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
});
