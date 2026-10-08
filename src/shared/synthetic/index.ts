// Synthetic world: every generator is a pure function of the seed (SPEC 11).
import { type Employee, generateEmployees } from "./employees.ts";
import { AMENITIES, type Amenity, type Resource, SITE, type Site, generateResources } from "./resources.ts";

export const SEED = 20261008;
/** generateHistory is pinned at this siteToday for its hash (SPEC 11). */
export const HISTORY_PIN_DATE = "2026-10-08";

export interface World {
  site: Site;
  amenities: Amenity[];
  employees: Employee[];
  resources: Resource[];
}

export function generateWorld(seed: number = SEED): World {
  return {
    site: { ...SITE },
    amenities: AMENITIES.map((a) => ({ ...a })),
    employees: generateEmployees(seed),
    resources: generateResources(),
  };
}

/** JSON with object keys sorted, so hashes do not depend on property order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const sorted: Record<string, unknown> = {};
      for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
      return sorted;
    }
    return v;
  });
}

/** Hex SHA-256 of canonicalJson(value), via Web Crypto (workerd, browsers and Node). */
export async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export { generateEmployees } from "./employees.ts";
export type { Employee } from "./employees.ts";
export { generateResources, SITE, AMENITIES, siteRulesOf } from "./resources.ts";
export type { Resource, Site, Amenity } from "./resources.ts";
export { generateLabeledRequests, generateSeedRequests } from "./requests.ts";
export type { LabeledRequest, SeedRequest } from "./requests.ts";
export { generateContentionAttempts, contentionStats, CONTENTION_ATTEMPTS } from "./contention.ts";
export type { ContentionAttempt, ContentionStats } from "./contention.ts";
export { generateHistory, HISTORY_DAYS } from "./history.ts";
export type { HistoryRow } from "./history.ts";
