// Dev-only routes (SPEC 8). Guarded by devOnly in app.ts, so in access mode they answer
// 404 as if they were never mounted.
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { DateQuery, DevLoginBody, type DevLoginResponse, DevSeedBody, type DevUsersResponse, ReserveBody } from "../../shared/api.ts";
import type { AppEnv } from "../app-env.ts";
import { signDevToken, DEV_TOKEN_TTL_SECONDS } from "../auth/dev-tokens.ts";
import { AUTH_COOKIE } from "../auth/middleware.ts";
import { errorResponse, jsonBody, queryParams } from "../http.ts";
import { findEmployeeById, listEmployees } from "../repo/employees.ts";
import { seedDatabase } from "../seed.ts";

export const devRoutes = new Hono<AppEnv>()
  .get("/api/dev/users", async (c) => {
    const users = await listEmployees(c.env.DB);
    const body: DevUsersResponse = {
      users: users.filter((u) => u.active).map((u) => ({ id: u.id, displayName: u.displayName, role: u.role, department: u.department })),
    };
    return c.json(body);
  })
  .post("/api/dev/login", jsonBody(DevLoginBody), async (c) => {
    const { employeeId } = c.req.valid("json");
    const employee = await findEmployeeById(c.env.DB, employeeId);
    if (!employee || !employee.active) return errorResponse(c, 403, "unknown_user", "No active employee with that id.");
    const auth = c.get("config").auth;
    if (auth.mode !== "dev") return errorResponse(c, 404, "not_found", "Not found.");
    const { token, exp } = await signDevToken({
      privateJwk: auth.privateJwk,
      issuer: auth.issuer,
      audience: auth.audience,
      email: employee.email,
      sub: employee.id,
      nowMs: c.get("deps").now(),
    });
    setCookie(c, AUTH_COOKIE, token, { httpOnly: true, sameSite: "Strict", path: "/", maxAge: DEV_TOKEN_TTL_SECONDS });
    const body: DevLoginResponse = { token, expiresAt: new Date(exp * 1000).toISOString() };
    return c.json(body);
  })
  .post("/api/dev/logout", (c) => {
    deleteCookie(c, AUTH_COOKIE, { path: "/" });
    return c.json({ ok: true });
  })
  .post("/api/dev/seed", jsonBody(DevSeedBody), async (c) => {
    const { reset, history } = c.req.valid("json");
    const result = await seedDatabase(c.env, c.get("config"), { reset, history, nowMs: c.get("deps").now() });
    return c.json(result);
  })
  // Negative control for the contention eval (SPEC 13.1): a deliberately unsafe
  // read-then-write booker on D1. The table is in no migration, and these routes exist
  // only in dev mode.
  .post("/api/dev/naive/reset", async (c) => {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `CREATE TABLE IF NOT EXISTS naive_reservations (
           id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, employee_id TEXT NOT NULL, date TEXT NOT NULL,
           start_min INTEGER NOT NULL, end_min INTEGER NOT NULL, created_at TEXT NOT NULL)`,
      ),
      c.env.DB.prepare("DELETE FROM naive_reservations"),
    ]);
    return c.json({ ok: true });
  })
  .post("/api/dev/naive/reserve", jsonBody(ReserveBody), async (c) => {
    const input = c.req.valid("json");
    const deps = c.get("deps");
    // Read...
    const clash = await c.env.DB.prepare(
      "SELECT start_min AS startMin, end_min AS endMin FROM naive_reservations WHERE resource_id = ? AND date = ? AND start_min < ? AND end_min > ?",
    )
      .bind(input.resourceId, input.date, input.endMin, input.startMin)
      .all<{ startMin: number; endMin: number }>();
    if (clash.results.length > 0) {
      return errorResponse(c, 409, "resource_conflict", "Overlaps an existing naive booking.", { conflicts: clash.results });
    }
    // ...then write, with no transaction spanning both: concurrent requests interleave here.
    // The row id comes from the Idempotency-Key, so an attempt the eval resends after a
    // transport failure can never add a second row and overlap itself. This only removes
    // self-duplicates; the read-then-write race between different attempts stays.
    const key = c.req.header("Idempotency-Key");
    const id = key ? `naive_${key}` : deps.newId("naive");
    const inserted = await c.env.DB.prepare(
      "INSERT OR IGNORE INTO naive_reservations (id, resource_id, employee_id, date, start_min, end_min, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(id, input.resourceId, c.get("principal").employeeId, input.date, input.startMin, input.endMin, new Date(deps.now()).toISOString())
      .run();
    if (inserted.meta.changes === 0) {
      return errorResponse(c, 409, "resource_conflict", "This attempt already has a naive booking.", { conflicts: [] });
    }
    return c.json({ reservation: { id, ...input } }, 201);
  })
  .get("/api/dev/naive/export", queryParams(DateQuery), async (c) => {
    const { date } = c.req.valid("query");
    const { results } = await c.env.DB.prepare(
      "SELECT id, resource_id AS resourceId, employee_id AS employeeId, date, start_min AS startMin, end_min AS endMin FROM naive_reservations WHERE date = ? ORDER BY resource_id, start_min",
    )
      .bind(date)
      .all();
    return c.json({ date, reservations: results });
  });
