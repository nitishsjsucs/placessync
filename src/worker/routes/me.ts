import { Hono } from "hono";
import type { MeResponse } from "../../shared/api.ts";
import type { AppEnv } from "../app-env.ts";

export const meRoutes = new Hono<AppEnv>().get("/api/me", (c) => {
  const p = c.get("principal");
  const body: MeResponse = {
    employee: { id: p.employeeId, email: p.email, displayName: p.displayName, department: p.department, role: p.role },
  };
  return c.json(body);
});
