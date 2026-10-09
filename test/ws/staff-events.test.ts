import { applyD1Migrations, reset, runInDurableObject, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ACTOR_HEADER } from "../../src/worker/ledger/live.ts";
import type { SiteLedger } from "../../src/worker/ledger/site-ledger.ts";
import { ADMIN, EMPLOYEE, STAFF, tokenFor } from "../helpers/tokens.ts";
import { bizDay, hqLedger, seed } from "../helpers/world.ts";
import { closeAll, connect, flush } from "../helpers/ws.ts";

beforeEach(async () => {
  await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS);
  await seed();
});
afterEach(async () => {
  await closeAll();
  await reset();
});

describe("staff events over the live socket (SPEC 7.1, 7.2)", () => {
  it("notifyStaff reaches staff and admin sockets that sent subscribe_staff, and no one else", async () => {
    const staff = await connect(await tokenFor(STAFF));
    const admin = await connect(await tokenFor(ADMIN));
    const quietStaff = await connect(await tokenFor(STAFF));
    staff.send({ type: "subscribe_staff" });
    admin.send({ type: "subscribe_staff" });
    await flush(staff);
    await flush(admin);
    const result = await hqLedger().notifyStaff({ event: "triage_ready", requestId: "req_test", category: "electrical_av" });
    expect(result).toEqual({ delivered: 2 });
    expect(await staff.next()).toEqual({ type: "staff_event", event: "triage_ready", requestId: "req_test", category: "electrical_av" });
    expect(await admin.next()).toMatchObject({ type: "staff_event", event: "triage_ready" });
    await flush(quietStaff);
    expect(quietStaff.messages.filter((m) => m.type === "staff_event")).toHaveLength(0);
  });

  it("answers subscribe_staff from an employee with forbidden and delivers nothing to it", async () => {
    const emp = await connect(await tokenFor(EMPLOYEE));
    emp.send({ type: "subscribe_staff" });
    expect(await emp.next()).toEqual({ type: "error", code: "forbidden" });
    expect(await hqLedger().notifyStaff({ event: "triage_unavailable", requestId: "req_x" })).toEqual({ delivered: 0 });
    await flush(emp);
    expect(emp.messages.filter((m) => m.type === "staff_event")).toHaveLength(0);
  });

  it("ignores a client-sent actor header: the socket acts as the token's employee", async () => {
    // SPEC 7.1: the Worker builds a fresh Request for the ledger, so a forged
    // X-PlacesSync-Actor claiming the admin never reaches it.
    const date = bizDay(2);
    const booked = await hqLedger().reserve({ employeeId: EMPLOYEE, role: "employee" }, { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, "ws-actor-1");
    expect(booked.ok).toBe(true);
    const forged = JSON.stringify({ employeeId: ADMIN, role: "facilities_admin", exp: 9_999_999_999 });
    const emp = await connect(await tokenFor(EMPLOYEE), undefined, { [ACTOR_HEADER]: forged });
    emp.send({ type: "subscribe_staff" });
    expect(await emp.next()).toEqual({ type: "error", code: "forbidden" });
    emp.send({ type: "subscribe", date });
    const snap = await emp.next((m) => m.type === "snapshot");
    expect((snap.busy as Record<string, unknown[]>).res_2a01).toEqual([{ startMin: 540, endMin: 660, mine: true }]);
  });

  it("closes an expired staff socket with 4001 instead of delivering", async () => {
    const staff = await connect(await tokenFor(STAFF, { ttlSeconds: 60 }));
    staff.send({ type: "subscribe_staff" });
    await flush(staff);
    await runInDurableObject(hqLedger(), (i: SiteLedger) => {
      i.clockOverride = () => Date.now() + 120_000;
    });
    expect(await hqLedger().notifyStaff({ event: "triage_overdue", requestId: "req_y" })).toEqual({ delivered: 0 });
    expect((await staff.closed).code).toBe(4001);
    expect(staff.messages.filter((m) => m.type === "staff_event")).toHaveLength(0);
  });

  it("the sweep hand-off reaches a subscribed staff socket", async () => {
    const { createExecutionContext, createScheduledController, waitOnExecutionContext } = await import("cloudflare:test");
    const worker = (await import("../../src/worker/index.ts")).default;
    const { insertRequest } = await import("../helpers/requests.ts");
    await env.DB.exec("UPDATE facilities_requests SET status = 'cancelled' WHERE status = 'submitted'");
    const id = await insertRequest({ ageMinutes: 5, triageAttempts: 3 });
    const staff = await connect(await tokenFor(STAFF));
    staff.send({ type: "subscribe_staff" });
    await flush(staff);
    const ctx = createExecutionContext();
    await worker.scheduled(createScheduledController({ cron: "*/2 * * * *", scheduledTime: Date.now() }), env, ctx);
    await waitOnExecutionContext(ctx);
    expect(await staff.next((m) => m.type === "staff_event")).toEqual({ type: "staff_event", event: "triage_unavailable", requestId: id });
  });
});
