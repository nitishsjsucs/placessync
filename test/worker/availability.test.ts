import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mulberry32, intBetween, pick } from "../../src/shared/rng.ts";
import { AMENITIES, generateResources } from "../../src/shared/synthetic/index.ts";
import { EMPLOYEE, EMPLOYEE_2 } from "../helpers/tokens.ts";
import { as, bizDay, hqLedger, json, seed } from "../helpers/world.ts";

type Slot = { startMin: number; endMin: number; mine?: boolean };
type Body = {
  date: string;
  version: number;
  ledgerVersion: number;
  resources: { resource: { id: string }; busy: Slot[]; freeWindows: Slot[]; fitsWindow: boolean }[];
};

beforeAll(async () => {
  await seed();
});
beforeEach(async () => {
  await hqLedger().resetForDev();
});

const all = generateResources();
const labels = new Map(AMENITIES.map((a) => [a.id, a.label]));

function oracleIds(f: { kind?: string; floor?: number; amenity?: string[]; minCapacity?: number; q?: string }): string[] {
  return all
    .filter(
      (r) =>
        (f.kind === undefined || r.kind === f.kind) &&
        (f.floor === undefined || r.floor === f.floor) &&
        (f.amenity ?? []).every((a) => r.amenities.indexOf(a) >= 0) &&
        (f.minCapacity === undefined || r.capacity >= f.minCapacity) &&
        (!f.q || [r.name, r.zone, r.description, ...r.amenities, ...r.amenities.map((a) => labels.get(a) ?? "")].join(" ").toLowerCase().indexOf(f.q.toLowerCase()) >= 0),
    )
    .map((r) => r.id)
    .sort();
}

/** Brute force: walk every 15-minute slot from 07:00 to 19:00 and collect free runs. */
function bruteFree(busy: Slot[]): Slot[] {
  const free: Slot[] = [];
  let start: number | null = null;
  for (let m = 420; m < 1140; m += 15) {
    const taken = busy.some((b) => b.startMin <= m && m < b.endMin);
    if (!taken && start === null) start = m;
    if (taken && start !== null) {
      free.push({ startMin: start, endMin: m });
      start = null;
    }
  }
  if (start !== null) free.push({ startMin: start, endMin: 1140 });
  return free;
}

describe("GET /api/sites/:siteId/availability", () => {
  it.each([
    ["", {}],
    ["&kind=room", { kind: "room" }],
    ["&floor=2&kind=desk", { floor: 2, kind: "desk" }],
    ["&amenity=video_conf", { amenity: ["video_conf"] }],
    ["&amenity=monitor,window", { amenity: ["monitor", "window"] }],
    ["&minCapacity=6", { minCapacity: 6 }],
    ["&q=south", { q: "south" }],
    ["&q=phone", { q: "phone" }],
  ] as const)("filters %s match the brute-force oracle", async (qs, f) => {
    const user = await as(EMPLOYEE);
    const body = await json<Body>(await user.get(`/api/sites/hq/availability?date=${bizDay(2)}${qs}`));
    expect(body.resources.map((r) => r.resource.id).sort()).toEqual(oracleIds(f as Parameters<typeof oracleIds>[0]));
  });

  it("reports busy intervals with mine flags, free windows and fit for a window", async () => {
    const date = bizDay(2);
    await hqLedger().reserve({ employeeId: EMPLOYEE, role: "employee" }, { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, "av-1");
    await hqLedger().reserve({ employeeId: EMPLOYEE_2, role: "employee" }, { resourceId: "res_2a02", date, startMin: 600, endMin: 720 }, "av-2");
    const user = await as(EMPLOYEE);
    const body = await json<Body>(await user.get(`/api/sites/hq/availability?date=${date}&kind=desk&floor=2&from=540&to=600`));
    expect(body.version).toBe(2);
    const byId = Object.fromEntries(body.resources.map((r) => [r.resource.id, r]));
    expect(byId.res_2a01?.busy).toEqual([{ startMin: 540, endMin: 660, mine: true }]);
    expect(byId.res_2a02?.busy).toEqual([{ startMin: 600, endMin: 720, mine: false }]);
    expect(byId.res_2a01?.freeWindows).toEqual([
      { startMin: 420, endMin: 540 },
      { startMin: 660, endMin: 1140 },
    ]);
    expect(byId.res_2a01?.fitsWindow).toBe(false);
    expect(byId.res_2a02?.fitsWindow).toBe(true);
    expect(byId.res_2a03?.fitsWindow).toBe(true);
  });

  it("requires a date", async () => {
    const user = await as(EMPLOYEE);
    const res = await user.get("/api/sites/hq/availability");
    expect(res.status).toBe(422);
    await res.body?.cancel();
  });

  it("freeWindows equals a brute-force slot scan for 200 random seeded ledgers", async () => {
    const rng = mulberry32(4242);
    const user = await as(EMPLOYEE);
    const desks = ["res_2a01", "res_2b01", "res_3a01"];
    const date = bizDay(3);
    for (let run = 0; run < 200; run++) {
      await hqLedger().resetForDev();
      const bookings = intBetween(rng, 0, 8);
      for (let b = 0; b < bookings; b++) {
        const start = 420 + intBetween(rng, 0, 40) * 15;
        const len = pick(rng, [60, 90, 120, 180, 240]);
        await hqLedger().reserve(
          { employeeId: `emp_${String(intBetween(rng, 1, 92)).padStart(3, "0")}`, role: "employee" },
          { resourceId: pick(rng, desks), date, startMin: start, endMin: Math.min(start + len, 1140) },
          `rand-${run}-${b}`,
        );
      }
      const body = await json<Body>(await user.get(`/api/sites/hq/availability?date=${date}&q=-01&kind=desk`));
      for (const r of body.resources) {
        expect(r.freeWindows, `run ${run} ${r.resource.id}`).toEqual(bruteFree(r.busy));
      }
    }
  }, 120_000);
});
