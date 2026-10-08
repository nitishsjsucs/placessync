import { Hono } from "hono";
import type { HealthResponse } from "../../shared/api.ts";
import { siteToday } from "../../shared/time.ts";
import type { AppEnv } from "../app-env.ts";
import { loadSite } from "../repo/catalog.ts";
import { createTriageProvider } from "../triage/provider-factory.ts";

export const healthRoutes = new Hono<AppEnv>().get("/api/health", async (c) => {
  const config = c.get("config");
  const site = await loadSite(c.env.DB, config.siteId);
  const triage = createTriageProvider(c.env, config).status;
  const body: HealthResponse = {
    ok: true,
    authMode: config.authMode,
    triage,
    siteId: config.siteId,
    seeded: site !== null,
    siteToday: site ? siteToday(site.timezone, c.get("deps").now()) : null,
    siteRules: site ? { timezone: site.timezone, openMin: site.openMin, closeMin: site.closeMin, horizonDays: site.horizonDays } : null,
  };
  return c.json(body);
});
