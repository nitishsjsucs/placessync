import type { Resource } from "../../shared/api.ts";
import type { Site } from "../../shared/synthetic/resources.ts";

export async function loadSite(db: D1Database, siteId: string): Promise<Site | null> {
  return db
    .prepare(
      "SELECT id, name, timezone, open_min AS openMin, close_min AS closeMin, horizon_days AS horizonDays FROM sites WHERE id = ?",
    )
    .bind(siteId)
    .first<Site>();
}

interface ResourceRow {
  id: string;
  siteId: string;
  kind: "desk" | "room";
  name: string;
  floor: number;
  zone: string;
  capacity: number;
  description: string;
  active: number;
  amenities: string | null;
}

const SELECT_RESOURCES = `
  SELECT r.id, r.site_id AS siteId, r.kind, r.name, r.floor, r.zone, r.capacity, r.description, r.active,
         (SELECT group_concat(amenity_id, ',') FROM (SELECT amenity_id FROM resource_amenities ra WHERE ra.resource_id = r.id ORDER BY amenity_id)) AS amenities
  FROM resources r`;

function toResource(row: ResourceRow): Resource {
  return {
    id: row.id,
    siteId: row.siteId,
    kind: row.kind,
    name: row.name,
    floor: row.floor,
    zone: row.zone,
    capacity: row.capacity,
    description: row.description,
    active: row.active === 1,
    amenities: row.amenities ? row.amenities.split(",") : [],
  };
}

export async function listResources(db: D1Database, siteId: string): Promise<Resource[]> {
  const { results } = await db.prepare(`${SELECT_RESOURCES} WHERE r.site_id = ? ORDER BY r.kind, r.name`).bind(siteId).all<ResourceRow>();
  return results.map(toResource);
}

export async function findResource(db: D1Database, resourceId: string): Promise<Resource | null> {
  const row = await db.prepare(`${SELECT_RESOURCES} WHERE r.id = ?`).bind(resourceId).first<ResourceRow>();
  return row ? toResource(row) : null;
}

export async function amenityLabels(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare("SELECT id, label FROM amenities").all<{ id: string; label: string }>();
  return new Map(results.map((r) => [r.id, r.label]));
}
