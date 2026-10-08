import { Hono } from "hono";
import { CalendarQuery, type CalendarResponse } from "../../shared/api.ts";
import { dayOfWeek, isValidDate } from "../../shared/time.ts";
import type { AppEnv } from "../app-env.ts";
import { ApiError, queryParams } from "../http.ts";
import { ledgerFor } from "../ledger/ledger-for.ts";
import { findResource } from "../repo/catalog.ts";

export const calendarRoutes = new Hono<AppEnv>().get("/api/resources/:resourceId/calendar", queryParams(CalendarQuery), async (c) => {
  const { weekStart } = c.req.valid("query");
  if (!isValidDate(weekStart) || dayOfWeek(weekStart) !== 1) {
    throw new ApiError(422, "validation", "weekStart must be a Monday.", {
      issues: [{ path: "weekStart", code: "not_monday", message: "weekStart must be a Monday." }],
    });
  }
  const resource = await findResource(c.env.DB, c.req.param("resourceId"));
  if (!resource) throw new ApiError(404, "resource_not_found", "No such resource.");
  const week = await ledgerFor(c.env, c.get("config"), resource.siteId).calendar(resource.id, weekStart, c.get("principal").employeeId);
  const body: CalendarResponse = { resource, days: week.days };
  return c.json(body);
});
