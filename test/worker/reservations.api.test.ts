import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ADMIN, EMPLOYEE, EMPLOYEE_2 } from "../helpers/tokens.ts";
import { as, bizDay, hqLedger, json, seed } from "../helpers/world.ts";

beforeAll(async () => {
  await seed();
});
beforeEach(async () => {
  await hqLedger().resetForDev();
});

let n = 0;
const key = () => `api-key-${++n}-${Date.now()}`;

describe("POST /api/reservations", () => {
  it("returns 201 with the reservation and versions", async () => {
    const user = await as(EMPLOYEE);
    const res = await user.post("/api/reservations", { resourceId: "res_2a01", date: bizDay(2), startMin: 540, endMin: 660 }, { "Idempotency-Key": key() });
    expect(res.status).toBe(201);
    const body = await json<{ reservation: { employeeId: string; status: string }; version: number; dateVersion: number }>(res);
    expect(body).toMatchObject({ reservation: { employeeId: EMPLOYEE, status: "confirmed" }, version: 1, dateVersion: 1 });
  });

  it("returns 409 resource_conflict with the conflicting intervals", async () => {
    const a = await as(EMPLOYEE);
    const b = await as(EMPLOYEE_2);
    const date = bizDay(2);
    await a.post("/api/reservations", { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, { "Idempotency-Key": key() }).then((r) => r.body?.cancel());
    const res = await b.post("/api/reservations", { resourceId: "res_2a01", date, startMin: 600, endMin: 720 }, { "Idempotency-Key": key() });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: "resource_conflict", conflicts: [{ startMin: 540, endMin: 660 }] });
  });

  it("returns 409 employee_conflict for a second overlapping desk", async () => {
    const a = await as(EMPLOYEE);
    const date = bizDay(2);
    await a.post("/api/reservations", { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, { "Idempotency-Key": key() }).then((r) => r.body?.cancel());
    const res = await a.post("/api/reservations", { resourceId: "res_2a02", date, startMin: 540, endMin: 660 }, { "Idempotency-Key": key() });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toBe("employee_conflict");
  });

  it("maps rule violations to 422 issues per field", async () => {
    const a = await as(EMPLOYEE);
    const res = await a.post("/api/reservations", { resourceId: "res_2a01", date: bizDay(2), startMin: 545, endMin: 1200 }, { "Idempotency-Key": key() });
    expect(res.status).toBe(422);
    const body = await json<{ error: string; issues: { path: string }[] }>(res);
    expect(body.error).toBe("validation");
    expect([...new Set(body.issues.map((i) => i.path))].sort()).toEqual(["endMin", "startMin"]);
  });

  it("maps type errors to 422 issues", async () => {
    const a = await as(EMPLOYEE);
    const res = await a.post("/api/reservations", { resourceId: "res_2a01", date: "tomorrow", startMin: "nine" }, { "Idempotency-Key": key() });
    expect(res.status).toBe(422);
    const body = await json<{ issues: { path: string }[] }>(res);
    expect(body.issues.map((i) => i.path)).toEqual(expect.arrayContaining(["date", "startMin", "endMin"]));
  });

  it("requires an Idempotency-Key of 8 to 64 characters", async () => {
    const a = await as(EMPLOYEE);
    const body = { resourceId: "res_2a01", date: bizDay(2), startMin: 540, endMin: 660 };
    const variants: Record<string, string>[] = [{}, { "Idempotency-Key": "short" }, { "Idempotency-Key": "x".repeat(65) }];
    for (const headers of variants) {
      const res = await a.post("/api/reservations", body, headers);
      expect(res.status).toBe(422);
      expect((await json<{ issues: { path: string }[] }>(res)).issues[0]?.path).toBe("Idempotency-Key");
    }
  });

  it("replays the identical body for a repeated Idempotency-Key", async () => {
    const a = await as(EMPLOYEE);
    const body = { resourceId: "res_2a03", date: bizDay(2), startMin: 540, endMin: 660 };
    const k = key();
    const first = await a.post("/api/reservations", body, { "Idempotency-Key": k });
    const second = await a.post("/api/reservations", body, { "Idempotency-Key": k });
    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(await first.text());
    const reuse = await a.post("/api/reservations", { ...body, endMin: 720 }, { "Idempotency-Key": k });
    expect(reuse.status).toBe(422);
    expect((await json(reuse)).error).toBe("idempotency_key_reuse");
  });

  it("returns 404 resource_not_found before any ledger call", async () => {
    const a = await as(EMPLOYEE);
    const res = await a.post("/api/reservations", { resourceId: "res_nope", date: bizDay(2), startMin: 540, endMin: 660 }, { "Idempotency-Key": key() });
    expect(res.status).toBe(404);
    expect((await json(res)).error).toBe("resource_not_found");
  });
});

describe("GET /api/reservations and cancel", () => {
  it("lists own bookings and cancels them", async () => {
    const a = await as(EMPLOYEE);
    const date = bizDay(2);
    const created = await json<{ reservation: { id: string } }>(
      await a.post("/api/reservations", { resourceId: "res_2a01", date, startMin: 540, endMin: 660 }, { "Idempotency-Key": key() }),
    );
    const list = await json<{ reservations: { id: string }[] }>(await a.get(`/api/reservations?from=${date}&to=${date}`));
    expect(list.reservations.map((r) => r.id)).toEqual([created.reservation.id]);
    const cancel = await a.post(`/api/reservations/${created.reservation.id}/cancel`, { reason: "not needed" });
    expect(cancel.status).toBe(200);
    expect((await json<{ reservation: { status: string } }>(cancel)).reservation.status).toBe("cancelled");
    const confirmed = await json<{ reservations: unknown[] }>(await a.get(`/api/reservations?from=${date}&to=${date}&status=confirmed`));
    expect(confirmed.reservations).toHaveLength(0);
    const again = await a.post(`/api/reservations/${created.reservation.id}/cancel`, {});
    expect(again.status).toBe(409);
    expect((await json(again)).error).toBe("not_confirmed");
  });

  it("refuses a non-owner cancel with 403 and lets an admin cancel", async () => {
    const a = await as(EMPLOYEE);
    const b = await as(EMPLOYEE_2);
    const admin = await as(ADMIN);
    const created = await json<{ reservation: { id: string } }>(
      await a.post("/api/reservations", { resourceId: "res_2a01", date: bizDay(2), startMin: 540, endMin: 660 }, { "Idempotency-Key": key() }),
    );
    const denied = await b.post(`/api/reservations/${created.reservation.id}/cancel`, {});
    expect(denied.status).toBe(403);
    expect((await json(denied)).error).toBe("not_owner");
    const ok = await admin.post(`/api/reservations/${created.reservation.id}/cancel`, {});
    expect(ok.status).toBe(200);
    await ok.body?.cancel();
  });

  it("lets only admins list another employee's bookings", async () => {
    const date = bizDay(2);
    const b = await as(EMPLOYEE_2);
    const admin = await as(ADMIN);
    const denied = await b.get(`/api/reservations?from=${date}&to=${date}&employeeId=${EMPLOYEE}`);
    expect(denied.status).toBe(403);
    await denied.body?.cancel();
    const ok = await admin.get(`/api/reservations?from=${date}&to=${date}&employeeId=${EMPLOYEE}`);
    expect(ok.status).toBe(200);
    await ok.body?.cancel();
  });
});
