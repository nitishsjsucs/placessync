// Workers Free plan budgets (src/worker/free-plan.ts): the cron sweep and the outbox
// flush each stay within D1's 50 queries per invocation, counting every statement inside
// a batch, and the sweep reads only its own site's submitted rows.
import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { D1_QUERIES_PER_INVOCATION } from "../../src/worker/free-plan.ts";
import { FLUSH_BATCH, type FactPayload, projectionStatements } from "../../src/worker/ledger/outbox.ts";
import { SWEEP_BATCH, SWEEP_MAX_D1_STATEMENTS, sweepStrandedRequests } from "../../src/worker/triage/sweep.ts";
import { insertRequest } from "../helpers/requests.ts";
import { seed } from "../helpers/world.ts";

/** Wraps a D1 binding and counts every statement it executes, batch members included. */
function countingD1(db: D1Database) {
  const counter = { statements: 0, rowsRead: 0 };
  const real = new WeakMap<object, D1PreparedStatement>();
  const track = <T>(p: Promise<T>): Promise<T> =>
    p.then((r) => {
      const meta = (r as { meta?: { rows_read?: number } } | null)?.meta;
      if (meta?.rows_read) counter.rowsRead += meta.rows_read;
      return r;
    });
  const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const proxy = new Proxy(stmt, {
      get(target, prop) {
        if (prop === "bind") return (...args: unknown[]) => wrap(target.bind(...args));
        if (prop === "run" || prop === "all") {
          return () => {
            counter.statements++;
            return track(target[prop]());
          };
        }
        if (prop === "first" || prop === "raw") {
          return (...args: never[]) => {
            counter.statements++;
            return (target[prop] as (...a: never[]) => unknown)(...args);
          };
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    real.set(proxy, stmt);
    return proxy;
  };
  const proxyDb = new Proxy(db, {
    get(target, prop) {
      if (prop === "prepare") return (sql: string) => wrap(target.prepare(sql));
      if (prop === "batch") {
        return async (stmts: D1PreparedStatement[]) => {
          counter.statements += stmts.length;
          const results = await target.batch(stmts.map((s) => real.get(s) ?? s));
          for (const r of results) if (r.meta?.rows_read) counter.rowsRead += r.meta.rows_read;
          return results;
        };
      }
      if (prop === "exec") {
        return (sql: string) => {
          counter.statements += sql.split(";").filter((x) => x.trim()).length;
          return target.exec(sql);
        };
      }
      const value = Reflect.get(target, prop, target) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
  return { db: proxyDb, counter };
}

beforeAll(async () => {
  await seed();
  await env.DB.exec("DELETE FROM request_events");
  await env.DB.exec("DELETE FROM triage_suggestions");
  await env.DB.exec("DELETE FROM facilities_requests");
});

describe("Workers Free plan: D1 queries per invocation", () => {
  it("the sweep's worst case (every row needs a new instance) issues SWEEP_MAX_D1_STATEMENTS, within 50", async () => {
    expect(SWEEP_MAX_D1_STATEMENTS).toBeLessThanOrEqual(D1_QUERIES_PER_INVOCATION);
    for (let i = 0; i < SWEEP_BATCH + 3; i++) await insertRequest({ ageMinutes: 10 + i });
    const { db, counter } = countingD1(env.DB);
    // No instance exists for any row (get throws), and create succeeds: startTriage's
    // batch plus its workflow_instance_id UPDATE, the costliest path per row.
    const created: string[] = [];
    const wf = {
      get: async () => {
        throw new Error("instance.not_found");
      },
      create: async (opts?: { id?: string }) => {
        created.push(String(opts?.id));
        return {} as WorkflowInstance;
      },
    };
    const summary = await sweepStrandedRequests({ ...env, DB: db }, { siteId: "hq" }, Date.now(), wf);
    expect(summary).toMatchObject({ examined: SWEEP_BATCH, created: SWEEP_BATCH });
    expect(created).toHaveLength(SWEEP_BATCH);
    expect(counter.statements).toBe(SWEEP_MAX_D1_STATEMENTS);
    expect(counter.statements).toBeLessThanOrEqual(D1_QUERIES_PER_INVOCATION);
  });

  it("a failed create costs no more than a successful one (batch, then the DELETE of its event)", async () => {
    await env.DB.exec("UPDATE facilities_requests SET status = 'cancelled' WHERE status = 'submitted'");
    for (let i = 0; i < SWEEP_BATCH; i++) await insertRequest({ ageMinutes: 10 + i });
    const { db, counter } = countingD1(env.DB);
    const down = {
      get: async () => {
        throw new Error("workflows unavailable");
      },
      create: async () => {
        throw new Error("workflows unavailable");
      },
    };
    const summary = await sweepStrandedRequests({ ...env, DB: db }, { siteId: "hq" }, Date.now(), down);
    expect(summary).toMatchObject({ examined: SWEEP_BATCH, createFailed: SWEEP_BATCH });
    expect(counter.statements).toBeLessThanOrEqual(SWEEP_MAX_D1_STATEMENTS);
  });

  it("the sweep searches the status index: rows read track the submitted rows, not the table", async () => {
    await env.DB.exec("UPDATE facilities_requests SET status = 'cancelled' WHERE status = 'submitted'");
    // 200 rows that are not submitted, then one submitted row in flight.
    for (let i = 0; i < 200; i++) await insertRequest({ status: "resolved", ageMinutes: 30 });
    await insertRequest({ ageMinutes: 10 });
    const { db, counter } = countingD1(env.DB);
    const inFlight = {
      get: async () => ({ status: async () => ({ status: "running" }) }) as unknown as WorkflowInstance,
      create: async () => ({}) as WorkflowInstance,
    };
    const summary = await sweepStrandedRequests({ ...env, DB: db }, { siteId: "hq" }, Date.now(), inFlight);
    expect(summary).toMatchObject({ examined: 1, inFlight: 1 });
    expect(counter.statements).toBe(1);
    expect(counter.rowsRead).toBeLessThan(10);
  });

  it("one outbox flush is FLUSH_BATCH upserts plus projection_state, within 50", () => {
    const fact: FactPayload = {
      reservationId: "r",
      siteId: "hq",
      resourceId: "res_2a01",
      resourceKind: "desk",
      employeeId: "emp_001",
      date: "2026-10-20",
      startMin: 540,
      endMin: 600,
      attendees: 1,
      status: "confirmed",
      createdAt: "2026-10-15T00:00:00.000Z",
      cancelledAt: null,
      ledgerVersion: 1,
    };
    const facts = Array.from({ length: FLUSH_BATCH }, (_, i) => ({ ...fact, reservationId: `r${i}`, ledgerVersion: i + 1 }));
    const stmts = projectionStatements(env.DB, "hq", facts, "2026-10-15T00:00:00.000Z");
    expect(stmts).toHaveLength(FLUSH_BATCH + 1);
    expect(stmts.length).toBeLessThanOrEqual(D1_QUERIES_PER_INVOCATION);
  });
});
