import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import type { SiteLedger } from "../../src/worker/ledger/site-ledger.ts";
import { authHeaders, tokenFor } from "../helpers/tokens.ts";
import { call, hqLedger, seed } from "../helpers/world.ts";

let result: Record<string, number>;
beforeAll(async () => {
  result = await seed();
});

describe("POST /api/dev/seed (SPEC 12.1)", () => {
  it("reports what it wrote", () => {
    expect(result).toEqual({ employees: 100, resources: 20, historyReservations: 0, requests: 40 });
  });

  it("writes 100 employees and 20 resources to D1", async () => {
    const counts = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM employees) AS e, (SELECT COUNT(*) FROM resources) AS r, (SELECT COUNT(*) FROM resource_amenities) AS a").first();
    expect(counts).toMatchObject({ e: 100, r: 20 });
    expect(Number(counts?.a)).toBeGreaterThan(20);
  });

  it("gives the ledger a 20-resource catalog and a site row that matches D1", async () => {
    const d1 = await env.DB.prepare("SELECT id, timezone, open_min, close_min, horizon_days FROM sites WHERE id = 'hq'").first();
    const ledger = await runInDurableObject(hqLedger(), (_i: SiteLedger, state) => ({
      site: state.storage.sql.exec("SELECT * FROM site").one(),
      resources: state.storage.sql.exec("SELECT COUNT(*) AS n FROM resources").one().n,
    }));
    expect(ledger.site).toEqual(d1);
    expect(ledger.resources).toBe(20);
  });

  it("lets all 100 employees call /api/me", async () => {
    const statuses = await Promise.all(
      Array.from({ length: 100 }, async (_, i) => {
        const id = `emp_${String(i + 1).padStart(3, "0")}`;
        const res = await call("/api/me", { headers: authHeaders(await tokenFor(id)) });
        await res.body?.cancel();
        return res.status;
      }),
    );
    expect(statuses.filter((s) => s === 200)).toHaveLength(100);
  });

  it("labels every seeded suggestion as the keyword stub, never an LLM", async () => {
    const { results } = await env.DB.prepare("SELECT provider, model, COUNT(*) AS n FROM triage_suggestions GROUP BY provider, model").all();
    expect(results).toEqual([{ provider: "stub", model: "keyword-v1", n: 40 }]);
    const ai = await env.DB.prepare("SELECT COUNT(*) AS n FROM triage_suggestions WHERE provider = 'workers-ai'").first<{ n: number }>();
    expect(ai?.n).toBe(0);
  });

  it("is idempotent without reset and seeds requests only once", async () => {
    const again = await call("/api/dev/seed", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reset: false }) });
    expect(await again.json()).toEqual({ employees: 100, resources: 20, historyReservations: 0, requests: 0 });
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM facilities_requests").first<{ n: number }>();
    expect(n?.n).toBe(40);
  });
});
