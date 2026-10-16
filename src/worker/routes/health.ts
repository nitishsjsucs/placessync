import { Hono } from "hono";
import type { HealthResponse } from "../../shared/api.ts";
import { siteToday } from "../../shared/time.ts";
import type { AppEnv } from "../app-env.ts";
import { errorResponse } from "../http.ts";
import { loadSite } from "../repo/catalog.ts";
import { createTriageProvider } from "../triage/provider-factory.ts";

/** D1 reports a query on a missing table as "no such table: <name>". */
function isMissingTable(err: unknown): boolean {
  return err instanceof Error && err.message.includes("no such table");
}

export const healthRoutes = new Hono<AppEnv>().get("/api/health", async (c) => {
  const config = c.get("config");
  let site: Awaited<ReturnType<typeof loadSite>>;
  try {
    site = await loadSite(c.env.DB, config.siteId);
  } catch (err) {
    // Local first run before `npm run db:migrate:local`: say what to do. Only in dev mode;
    // in access mode the error goes to the generic 500 handler exactly as before.
    if (config.authMode === "dev" && isMissingTable(err)) {
      return errorResponse(c, 503, "schema_missing", "The local database has no tables yet. Run npm run db:migrate:local, then reload.");
    }
    throw err;
  }
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
