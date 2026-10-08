import type { Site } from "../../shared/synthetic/resources.ts";

export async function loadSite(db: D1Database, siteId: string): Promise<Site | null> {
  return db
    .prepare(
      "SELECT id, name, timezone, open_min AS openMin, close_min AS closeMin, horizon_days AS horizonDays FROM sites WHERE id = ?",
    )
    .bind(siteId)
    .first<Site>();
}
