// Admin routes (SPEC 8): reports from D1, ledger export and projection status.
import { Hono } from "hono";
import { DateQuery, DateRangeQuery, ResourcePatchBody } from "../../shared/api.ts";
import type { AppEnv } from "../app-env.ts";
import { requireRole } from "../auth/middleware.ts";
import { ApiError, jsonBody, queryParams } from "../http.ts";
import { findResource } from "../repo/catalog.ts";
import { ledgerFor } from "../ledger/ledger-for.ts";
import { projectionState, requestsReport, reservationFacts, utilizationReport } from "../repo/reports.ts";

export const adminRoutes = new Hono<AppEnv>()
  .use("/api/admin/*", requireRole("facilities_admin"))
  .get("/api/admin/reports/utilization", queryParams(DateRangeQuery), async (c) => {
    const { from, to, kind } = c.req.valid("query");
    return c.json(await utilizationReport(c.env.DB, c.get("config").siteId, from, to, kind));
  })
  .get("/api/admin/reports/requests", queryParams(DateRangeQuery), async (c) => {
    const { from, to } = c.req.valid("query");
    return c.json(await requestsReport(c.env.DB, c.get("config").siteId, from, to));
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
  })
  // Resource admin (Tier 2): update D1, then resync the ledger's catalog copy so the
  // booking rules see the change at once.
  .patch("/api/admin/resources/:id", jsonBody(ResourcePatchBody), async (c) => {
    const body = c.req.valid("json");
    const config = c.get("config");
    const resource = await findResource(c.env.DB, c.req.param("id"));
    if (!resource || resource.siteId !== config.siteId) throw new ApiError(404, "resource_not_found", "No such resource.");
    if (body.capacity !== undefined && resource.kind === "desk" && body.capacity !== 1) {
      throw new ApiError(422, "validation", "A desk seats one person.", { issues: [{ path: "capacity", code: "desk_capacity", message: "A desk seats one person." }] });
    }
    await c.env.DB.prepare(
      "UPDATE resources SET active = COALESCE(?, active), capacity = COALESCE(?, capacity), description = COALESCE(?, description) WHERE id = ?",
    )
      .bind(body.active === undefined ? null : body.active ? 1 : 0, body.capacity ?? null, body.description ?? null, resource.id)
      .run();
    await ledgerFor(c.env, config, config.siteId).syncCatalog();
    return c.json({ resource: await findResource(c.env.DB, resource.id) });
  });
