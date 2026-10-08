import { Hono } from "hono";
import { AvailabilityQuery, type AvailabilityResponse } from "../../shared/api.ts";
import { fitsWindow, freeWindows } from "../../shared/intervals.ts";
import { filterResources } from "../../shared/resource-filter.ts";
import type { AppEnv } from "../app-env.ts";
import { ApiError, queryParams } from "../http.ts";
import { ledgerFor } from "../ledger/ledger-for.ts";
import { amenityLabels, listResources, loadSite } from "../repo/catalog.ts";

export const availabilityRoutes = new Hono<AppEnv>().get(
  "/api/sites/:siteId/availability",
  queryParams(AvailabilityQuery),
  async (c) => {
    const q = c.req.valid("query");
    const config = c.get("config");
    const [site, resources, labels] = await Promise.all([
      loadSite(c.env.DB, config.siteId),
      listResources(c.env.DB, config.siteId),
      amenityLabels(c.env.DB),
    ]);
    if (!site) throw new ApiError(404, "site_not_found", "The site has not been seeded.");
    const matching = filterResources(
      resources.filter((r) => r.active),
      q,
      labels,
    );
    const ledger = ledgerFor(c.env, config, config.siteId);
    const snap = await ledger.availability(
      q.date,
      matching.map((r) => r.id),
      c.get("principal").employeeId,
    );
    const want = q.from !== undefined && q.to !== undefined && q.to > q.from ? { startMin: q.from, endMin: q.to } : null;
    const body: AvailabilityResponse = {
      date: q.date,
      version: snap.dateVersion,
      ledgerVersion: snap.ledgerVersion,
      resources: matching.map((resource) => {
        const busy = snap.busy[resource.id] ?? [];
        const free = freeWindows(busy, site.openMin, site.closeMin);
        return { resource, busy, freeWindows: free, fitsWindow: want ? fitsWindow(free, want) : free.length > 0 };
      }),
    };
    return c.json(body);
  },
);
