import { beforeAll, describe, expect, it } from "vitest";
import { AMENITIES, generateResources } from "../../src/shared/synthetic/index.ts";
import { EMPLOYEE } from "../helpers/tokens.ts";
import { as, json, seed } from "../helpers/world.ts";

beforeAll(async () => {
  await seed();
});

type R = { id: string; kind: string; floor: number; capacity: number; name: string; zone: string; description: string; amenities: string[] };
const all = generateResources();
const labels = new Map(AMENITIES.map((a) => [a.id, a.label]));

// Brute-force oracle written independently of src/shared/resource-filter.ts.
function oracle(f: { kind?: string; floor?: number; amenity?: string[]; minCapacity?: number; q?: string }): string[] {
  const out: string[] = [];
  for (const r of all) {
    let ok = true;
    if (f.kind !== undefined) ok &&= r.kind === f.kind;
    if (f.floor !== undefined) ok &&= r.floor === f.floor;
    for (const a of f.amenity ?? []) ok &&= r.amenities.indexOf(a) >= 0;
    if (f.minCapacity !== undefined) ok &&= r.capacity >= f.minCapacity;
    if (f.q) {
      const needle = f.q.toLowerCase();
      const fields = [r.name, r.zone, r.description, ...r.amenities, ...r.amenities.map((a) => labels.get(a) ?? "")];
      ok &&= fields.join(" ").toLowerCase().indexOf(needle) >= 0;
    }
    if (ok) out.push(r.id);
  }
  return out.sort();
}

async function search(qs: string): Promise<string[]> {
  const user = await as(EMPLOYEE);
  const res = await user.get(`/api/sites/hq/resources${qs}`);
  expect(res.status).toBe(200);
  return (await json<{ resources: R[] }>(res)).resources.map((r) => r.id).sort();
}

describe("GET /api/sites/:siteId/resources", () => {
  it("returns all 20 resources with amenities", async () => {
    const user = await as(EMPLOYEE);
    const body = await json<{ resources: R[] }>(await user.get("/api/sites/hq/resources"));
    expect(body.resources).toHaveLength(20);
    const d = body.resources.find((r) => r.id === "res_2a01");
    expect(d?.amenities).toEqual(["monitor", "standing_desk", "window"]);
  });

  const cases: [string, Parameters<typeof oracle>[0]][] = [
    ["?kind=desk", { kind: "desk" }],
    ["?kind=room", { kind: "room" }],
    ["?floor=3", { floor: 3 }],
    ["?amenity=window", { amenity: ["window"] }],
    ["?amenity=display,whiteboard", { amenity: ["display", "whiteboard"] }],
    ["?minCapacity=8", { minCapacity: 8 }],
    ["?kind=room&floor=2&minCapacity=4", { kind: "room", floor: 2, minCapacity: 4 }],
    ["?q=sequoia", { q: "sequoia" }],
    ["?q=north", { q: "north" }],
    ["?q=video", { q: "video" }],
    ["?q=Dual%20monitors", { q: "Dual monitors" }],
    ["?kind=desk&amenity=standing_desk&floor=3", { kind: "desk", amenity: ["standing_desk"], floor: 3 }],
    ["?q=nothing-matches", { q: "nothing-matches" }],
  ];
  it.each(cases)("%s matches the brute-force oracle", async (qs, f) => {
    expect(await search(qs)).toEqual(oracle(f));
  });

  it("rejects malformed filters with 422", async () => {
    const user = await as(EMPLOYEE);
    for (const qs of ["?kind=sofa", "?floor=two", "?minCapacity=0"]) {
      const res = await user.get(`/api/sites/hq/resources${qs}`);
      expect(res.status).toBe(422);
      expect((await json(res)).error).toBe("validation");
    }
  });
});
