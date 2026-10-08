// Resource search (SPEC 8): kind, floor, all-of amenities, minimum capacity and a
// case-insensitive free-text match over name, zone, description and amenities.
import type { Resource, ResourceFilters } from "./api.ts";

export function matchesFilters(r: Resource, f: ResourceFilters, amenityLabels: ReadonlyMap<string, string> = new Map()): boolean {
  if (f.kind && r.kind !== f.kind) return false;
  if (f.floor !== undefined && r.floor !== f.floor) return false;
  if (f.amenity && !f.amenity.every((a) => r.amenities.includes(a))) return false;
  if (f.minCapacity !== undefined && r.capacity < f.minCapacity) return false;
  const q = f.q?.trim().toLowerCase();
  if (q) {
    const haystack = [r.name, r.zone, r.description, ...r.amenities, ...r.amenities.map((a) => amenityLabels.get(a) ?? "")]
      .join(" ")
      .toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

export function filterResources(
  resources: readonly Resource[],
  f: ResourceFilters,
  amenityLabels?: ReadonlyMap<string, string>,
): Resource[] {
  return resources.filter((r) => matchesFilters(r, f, amenityLabels));
}
