// The four facilities service categories (SPEC 10.1). Everything else (JSON Schema
// enum, zod enum, D1 CHECK constraints) must match this tuple.
export const CATEGORIES = ["building_systems", "electrical_av", "furniture_fixtures", "cleaning_safety"] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  building_systems: "Building systems",
  electrical_av: "Electrical and AV",
  furniture_fixtures: "Furniture and fixtures",
  cleaning_safety: "Cleaning and safety",
};

export const CATEGORY_SCOPE: Record<Category, string> = {
  building_systems: "heating, cooling, ventilation, air quality, plumbing, leaks, water",
  electrical_av: "power, outlets, lighting, displays, projectors, conferencing and AV gear",
  furniture_fixtures: "desks, chairs, doors, locks, whiteboards, blinds, shelving",
  cleaning_safety: "spills, trash, restroom supplies, pests, odors, trip hazards",
};

export function isCategory(value: unknown): value is Category {
  return typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);
}
