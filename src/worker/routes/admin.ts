// Admin routes (SPEC 8): reports from D1, ledger export and projection status.
import { Hono } from "hono";
import { DateQuery, DateRangeQuery } from "../../shared/api.ts";
import type { AppEnv } from "../app-env.ts";
import { requireRole } from "../auth/middleware.ts";
import { queryParams } from "../http.ts";
import { ledgerFor } from "../ledger/ledger-for.ts";
import { projectionState, reservationFacts, utilizationReport } from "../repo/reports.ts";

export const adminRoutes = new Hono<AppEnv>()
  .use("/api/admin/*", requireRole("facilities_admin"))
  .get("/api/admin/reports/utilization", queryParams(DateRangeQuery), async (c) => {
    const { from, to, kind } = c.req.valid("query");
    return c.json(await utilizationReport(c.env.DB, c.get("config").siteId, from, to, kind));
  })
  .get("/api/admin/reports/reservations", queryParams(DateQuery), async (c) => {
    const { date } = c.req.valid("query");
    return c.json({ date, facts: await reservationFacts(c.env.DB, c.get("config").siteId, date) });
  })
  .get("/api/admin/ledger/export", queryParams(DateQuery), async (c) => {
    const { date } = c.req.valid("query");
    const config = c.get("config");
    return c.json({ date, reservations: await ledgerFor(c.env, config, config.siteId).exportDay(date) });
  })
  .get("/api/admin/projection/status", async (c) => {
    const config = c.get("config");
    const [ledger, d1] = await Promise.all([ledgerFor(c.env, config, config.siteId).projectionStatus(), projectionState(c.env.DB, config.siteId)]);
    return c.json({ ...ledger, d1: d1 ?? null });
  });
