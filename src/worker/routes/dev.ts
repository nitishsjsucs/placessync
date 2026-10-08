// Dev-only routes (SPEC 8). Guarded by devOnly in app.ts, so in access mode they answer
// 404 as if they were never mounted.
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { DevLoginBody, type DevLoginResponse, DevSeedBody, type DevUsersResponse } from "../../shared/api.ts";
import type { AppEnv } from "../app-env.ts";
import { signDevToken, DEV_TOKEN_TTL_SECONDS } from "../auth/dev-tokens.ts";
import { AUTH_COOKIE } from "../auth/middleware.ts";
import { errorResponse, jsonBody } from "../http.ts";
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
    const result = await seedDatabase(c.env, { reset, history, nowMs: c.get("deps").now() });
    return c.json(result);
  });
