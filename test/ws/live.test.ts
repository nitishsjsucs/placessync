import { applyD1Migrations, evictDurableObject, reset, runInDurableObject, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PING } from "../../src/shared/live-protocol.ts";
import type { SiteLedger } from "../../src/worker/ledger/site-ledger.ts";
import { EMPLOYEE, EMPLOYEE_2, authHeaders, tokenFor } from "../helpers/tokens.ts";
import { bizDay, call, hqLedger, seed } from "../helpers/world.ts";
import { closeAll, connect, flush } from "../helpers/ws.ts";

beforeEach(async () => {
  await applyD1Migrations(env.DB, (env as unknown as { TEST_MIGRATIONS: D1Migration[] }).TEST_MIGRATIONS);
  await seed();
});
afterEach(async () => {
  await closeAll();
  await reset();
});

const emp = { employeeId: EMPLOYEE, role: "employee" as const };
const emp2 = { employeeId: EMPLOYEE_2, role: "employee" as const };
let n = 0;
const k = () => `live-${++n}`;

describe("per-date live availability (SPEC 7.2)", () => {
  it("subscribe returns a snapshot with dateVersion and ledgerVersion", async () => {
    const date = bizDay(2);
    await hqLedger().reserve(emp2, { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, k());
    const c = await connect(await tokenFor(EMPLOYEE));
    c.send({ type: "subscribe", date });
    const snap = await c.next((m) => m.type === "snapshot");
    expect(snap).toMatchObject({ date, dateVersion: 1, ledgerVersion: 1 });
    expect((snap.busy as Record<string, unknown[]>).res_2a01).toEqual([{ startMin: 540, endMin: 660, mine: false }]);
    expect(Object.keys(snap.busy as object)).toHaveLength(20);
  });

  it("a booking sends one booked delta to that date's subscribers only, with dateVersion + 1 and per-socket mine", async () => {
    const a = bizDay(2);
    const b = bizDay(3);
    const mine = await connect(await tokenFor(EMPLOYEE));
    const other = await connect(await tokenFor(EMPLOYEE_2));
    const elsewhere = await connect(await tokenFor(EMPLOYEE_2));
    mine.send({ type: "subscribe", date: a });
    other.send({ type: "subscribe", date: a });
    elsewhere.send({ type: "subscribe", date: b });
    const s1 = await mine.next((m) => m.type === "snapshot");
    await other.next((m) => m.type === "snapshot");
    await elsewhere.next((m) => m.type === "snapshot");

    await hqLedger().reserve(emp, { resourceId: "res_2a01", date: a, startMin: 540, endMin: 660 }, k());
    const d1 = await mine.next();
    const d2 = await other.next();
    expect(d1).toMatchObject({ type: "delta", op: "booked", date: a, dateVersion: (s1.dateVersion as number) + 1, resourceId: "res_2a01", startMin: 540, endMin: 660, mine: true });
    expect(d2).toMatchObject({ type: "delta", op: "booked", mine: false });
    expect(JSON.stringify(d2)).not.toContain(EMPLOYEE);
    await flush(elsewhere);
    expect(elsewhere.messages.filter((m) => m.type === "delta")).toHaveLength(0);
  });

  it("a cancellation sends a released delta", async () => {
    const date = bizDay(2);
    const c = await connect(await tokenFor(EMPLOYEE_2));
    c.send({ type: "subscribe", date });
    await c.next((m) => m.type === "snapshot");
    const r = await hqLedger().reserve(emp, { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, k());
    if (!r.ok) throw new Error("booking failed");
    await c.next((m) => m.type === "delta" && m.op === "booked");
    await hqLedger().cancel(emp, r.reservation.id);
    expect(await c.next()).toMatchObject({ type: "delta", op: "released", resourceId: "res_2a01", dateVersion: 2, ledgerVersion: 2 });
  });

  it("cross-date: an A-only socket sees nothing while 10 bookings land on B, and its next A delta is last + 1", async () => {
    const a = bizDay(2);
    const b = bizDay(3);
    const c = await connect(await tokenFor(EMPLOYEE));
    c.send({ type: "subscribe", date: a });
    const snap = await c.next((m) => m.type === "snapshot");
    const last = snap.dateVersion as number;
    for (let i = 0; i < 10; i++) {
      await hqLedger().reserve(
        { employeeId: `emp_0${String(10 + i)}`, role: "employee" },
        { resourceId: "res_2a01", date: b, startMin: 420 + i * 60, endMin: 480 + i * 60 },
        k(),
      );
    }
    await hqLedger().reserve(emp2, { resourceId: "res_2a02", date: a, startMin: 540, endMin: 660 }, k());
    const next = await c.next();
    // Nothing about B arrived first: no delta, no snapshot, no error.
    expect(next).toMatchObject({ type: "delta", date: a, dateVersion: last + 1, ledgerVersion: 11 });
    expect(c.messages).toHaveLength(2);
  });

  it("survives hibernation: the attachment persists and the next booking reaches the socket", async () => {
    const date = bizDay(2);
    const c = await connect(await tokenFor(EMPLOYEE));
    c.send({ type: "subscribe", date });
    await c.next((m) => m.type === "snapshot");
    await evictDurableObject(hqLedger());
    await hqLedger().reserve(emp2, { resourceId: "res_2a03", date, startMin: 540, endMin: 660 }, k());
    expect(await c.next()).toMatchObject({ type: "delta", op: "booked", resourceId: "res_2a03", mine: false });
  });

  it("answers ping through the auto-response, not the message handler", async () => {
    // The handler checks expiry first and would answer an expired socket with
    // session_expired and close 4001; the auto-response never runs the handler.
    const c = await connect(await tokenFor(EMPLOYEE, { ttlSeconds: 60 }));
    await runInDurableObject(hqLedger(), (i: SiteLedger, state: DurableObjectState) => {
      i.clockOverride = () => Date.now() + 120_000;
      expect(state.getWebSocketAutoResponseTimestamp(state.getWebSockets()[0] as WebSocket)).toBeNull();
    });
    c.send(PING);
    expect(await c.next()).toEqual({ type: "pong" });
    await runInDurableObject(hqLedger(), (_i: SiteLedger, state: DurableObjectState) => {
      expect(state.getWebSocketAutoResponseTimestamp(state.getWebSockets()[0] as WebSocket)).toBeInstanceOf(Date);
    });
    // The same expired socket, sent anything else, reaches the handler and is closed.
    c.send({ type: "subscribe", date: bizDay(2) });
    expect(await c.next()).toEqual({ type: "error", code: "session_expired" });
    expect((await c.closed).code).toBe(4001);
  });

  it("rejects malformed messages and more than 14 dates", async () => {
    const c = await connect(await tokenFor(EMPLOYEE));
    c.send("not json");
    expect(await c.next()).toEqual({ type: "error", code: "bad_message" });
    c.send({ type: "subscribe", date: "tomorrow" });
    expect(await c.next()).toEqual({ type: "error", code: "bad_message" });
    for (let i = 1; i <= 14; i++) c.send({ type: "subscribe", date: `2030-01-${String(i).padStart(2, "0")}` });
    for (let i = 1; i <= 14; i++) await c.next((m) => m.type === "snapshot");
    c.send({ type: "subscribe", date: "2030-01-15" });
    expect(await c.next()).toEqual({ type: "error", code: "too_many_dates" });
  });

  it("closes an expired socket with 4001 on its next message", async () => {
    const token = await tokenFor(EMPLOYEE, { ttlSeconds: 60 });
    const c = await connect(token);
    await runInDurableObject(hqLedger(), (i: SiteLedger) => {
      i.clockOverride = () => Date.now() + 120_000;
    });
    c.send({ type: "subscribe", date: bizDay(2) });
    expect(await c.next()).toEqual({ type: "error", code: "session_expired" });
    expect((await c.closed).code).toBe(4001);
  });

  it("closes an expired socket with 4001 on the next broadcast and sends it no delta", async () => {
    const date = bizDay(2);
    const c = await connect(await tokenFor(EMPLOYEE, { ttlSeconds: 60 }));
    c.send({ type: "subscribe", date });
    await c.next((m) => m.type === "snapshot");
    await runInDurableObject(hqLedger(), (i: SiteLedger) => {
      i.clockOverride = () => Date.now() + 120_000;
    });
    await hqLedger().reserve(emp2, { resourceId: "res_2a01", date, startMin: 600, endMin: 720 }, k());
    expect((await c.closed).code).toBe(4001);
    expect(c.messages.filter((m) => m.type === "delta")).toHaveLength(0);
    expect(c.messages.at(-1)).toEqual({ type: "error", code: "session_expired" });
  });

  it("refuses an unauthenticated upgrade with 401 and a plain GET with 426", async () => {
    const unauth = await call("/api/sites/hq/live", { headers: { upgrade: "websocket" } });
    expect(unauth.status).toBe(401);
    await unauth.body?.cancel();
    const plain = await call("/api/sites/hq/live", { headers: authHeaders(await tokenFor(EMPLOYEE)) });
    expect(plain.status).toBe(426);
    await plain.body?.cancel();
  });
});
