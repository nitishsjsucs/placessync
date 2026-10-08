import type { ResourceKind, SiteRules } from "../rules.ts";

export interface Site {
  id: string;
  name: string;
  timezone: string;
  openMin: number;
  closeMin: number;
  horizonDays: number;
}

export interface Amenity {
  id: string;
  label: string;
}

export interface Resource {
  id: string;
  siteId: string;
  kind: ResourceKind;
  name: string;
  floor: number;
  zone: string;
  capacity: number;
  description: string;
  active: boolean;
  amenities: string[];
}

export const SITE: Site = {
  id: "hq",
  name: "PlacesSync HQ",
  timezone: "America/Los_Angeles",
  openMin: 420,
  closeMin: 1140,
  horizonDays: 14,
};

export function siteRulesOf(site: Pick<Site, "timezone" | "openMin" | "closeMin" | "horizonDays">): SiteRules {
  return { timezone: site.timezone, openMin: site.openMin, closeMin: site.closeMin, horizonDays: site.horizonDays };
}

export const AMENITIES: readonly Amenity[] = [
  { id: "monitor", label: "Monitor" },
  { id: "dual_monitor", label: "Dual monitors" },
  { id: "docking_station", label: "Docking station" },
  { id: "standing_desk", label: "Standing desk" },
  { id: "window", label: "Window seat" },
  { id: "display", label: "Wall display" },
  { id: "video_conf", label: "Video conferencing" },
  { id: "whiteboard", label: "Whiteboard" },
  { id: "phone_booth", label: "Phone booth" },
];

function desk(row: string, n: number, floor: number, zone: string, amenities: string[]): Resource {
  const num = String(n).padStart(2, "0");
  return {
    id: `res_${row.toLowerCase()}${num}`,
    siteId: SITE.id,
    kind: "desk",
    name: `Desk ${row}-${num}`,
    floor,
    zone,
    capacity: 1,
    description: `Bookable desk on floor ${floor}, ${zone.toLowerCase()} side.`,
    active: true,
    amenities,
  };
}

function room(name: string, floor: number, zone: string, capacity: number, amenities: string[]): Resource {
  return {
    id: `res_${name.toLowerCase()}`,
    siteId: SITE.id,
    kind: "room",
    name,
    floor,
    zone,
    capacity,
    description: `Meeting room for up to ${capacity} on floor ${floor}, ${zone.toLowerCase()} side.`,
    active: true,
    amenities,
  };
}

const RESOURCES: readonly Resource[] = [
  desk("2A", 1, 2, "North", ["monitor", "standing_desk", "window"]),
  desk("2A", 2, 2, "North", ["monitor", "standing_desk"]),
  desk("2A", 3, 2, "North", ["monitor", "window"]),
  desk("2A", 4, 2, "North", ["monitor"]),
  desk("2B", 1, 2, "South", ["docking_station", "dual_monitor"]),
  desk("2B", 2, 2, "South", ["docking_station", "dual_monitor"]),
  desk("2B", 3, 2, "South", ["docking_station"]),
  desk("2B", 4, 2, "South", ["docking_station"]),
  desk("3A", 1, 3, "North", ["monitor", "window"]),
  desk("3A", 2, 3, "North", ["monitor"]),
  desk("3A", 3, 3, "North", ["monitor"]),
  desk("3B", 1, 3, "South", ["monitor"]),
  desk("3B", 2, 3, "South", ["monitor", "standing_desk"]),
  desk("3B", 3, 3, "South", ["monitor"]),
  room("Redwood", 2, "North", 4, ["display", "video_conf"]),
  room("Sequoia", 2, "South", 8, ["display", "video_conf", "whiteboard"]),
  room("Cypress", 2, "South", 2, ["phone_booth"]),
  room("Juniper", 3, "North", 6, ["display", "whiteboard"]),
  room("Alder", 3, "South", 10, ["display", "video_conf", "whiteboard"]),
  room("Madrone", 3, "South", 12, ["display", "video_conf"]),
];

/** Exactly 20: 14 desks and 6 rooms (SPEC 11.2). Returns fresh copies. */
export function generateResources(): Resource[] {
  return RESOURCES.map((r) => ({ ...r, amenities: [...r.amenities] }));
}
