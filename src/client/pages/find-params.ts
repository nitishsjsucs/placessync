// Find a space keeps its date, tab and filters in the URL (?date=&kind=&floor=...), so a
// reload, Back from a week calendar or a shared link shows the same search. Parsing is
// strict: a parameter that is not one of the values the page offers is dropped and never
// sent to the API. Defaults are omitted when writing.
import { SEARCH_MAX } from "../../shared/api.ts";
import { AMENITIES } from "../../shared/synthetic/resources.ts";
import { DATE_RE, isValidDate } from "../../shared/time.ts";
import { type SiteContext, dateDisabledReason } from "./site.ts";

export type Kind = "all" | "desk" | "room";

export interface FindFilters {
  date: string;
  kind: Kind;
  floor: string;
  minCapacity: string;
  amenities: string[];
  q: string;
  from: string;
  to: string;
}

export const KINDS: readonly Kind[] = ["all", "desk", "room"];
export const FLOORS = ["2", "3"] as const;
export const CAPACITIES = ["2", "4", "6", "8", "10"] as const;
/** The search box takes what the API accepts, so a long search is never refused. */
export const Q_MAX = SEARCH_MAX;
const AMENITY_IDS = new Set(AMENITIES.map((a) => a.id));

/** A date someone can book on (YYYY-MM-DD, weekday, inside the horizon), else null. */
export function bookableDateParam(value: string | null, site: SiteContext): string | null {
  if (!value || !DATE_RE.test(value) || !isValidDate(value)) return null;
  return dateDisabledReason(value, site) ? null : value;
}

/** Start times the Free from list offers (open to the last half hour). */
export function fromTimes(site: SiteContext): number[] {
  const out: number[] = [];
  for (let m = site.rules.openMin; m < site.rules.closeMin; m += 30) out.push(m);
  return out;
}

/** End times the Until list offers (the first half hour to close). */
export function toTimes(site: SiteContext): number[] {
  const out: number[] = [];
  for (let m = site.rules.openMin + 30; m <= site.rules.closeMin; m += 30) out.push(m);
  return out;
}

function boundary(value: string | null, allowed: readonly number[]): string {
  if (!value || !/^\d{1,4}$/.test(value)) return "";
  return allowed.includes(Number(value)) ? String(Number(value)) : "";
}

export function parseFindParams(params: URLSearchParams, site: SiteContext, defaultDate: string): FindFilters {
  const kind = params.get("kind");
  const floor = params.get("floor") ?? "";
  const minCapacity = params.get("minCapacity") ?? "";
  const amenities = [...new Set((params.get("amenity") ?? "").split(",").filter((a) => AMENITY_IDS.has(a)))];
  let from = boundary(params.get("from"), fromTimes(site));
  let to = boundary(params.get("to"), toTimes(site));
  if (from && to && Number(to) <= Number(from)) {
    from = "";
    to = "";
  }
  return {
    date: bookableDateParam(params.get("date"), site) ?? defaultDate,
    kind: KINDS.includes(kind as Kind) ? (kind as Kind) : "all",
    floor: (FLOORS as readonly string[]).includes(floor) ? floor : "",
    minCapacity: (CAPACITIES as readonly string[]).includes(minCapacity) ? minCapacity : "",
    amenities,
    q: (params.get("q") ?? "").slice(0, Q_MAX),
    from,
    to,
  };
}

export function writeFindParams(f: FindFilters, defaultDate: string): URLSearchParams {
  const out = new URLSearchParams();
  if (f.date !== defaultDate) out.set("date", f.date);
  if (f.kind !== "all") out.set("kind", f.kind);
  if (f.floor) out.set("floor", f.floor);
  if (f.minCapacity) out.set("minCapacity", f.minCapacity);
  if (f.amenities.length) out.set("amenity", f.amenities.join(","));
  if (f.q) out.set("q", f.q.slice(0, Q_MAX));
  if (f.from) out.set("from", f.from);
  if (f.to) out.set("to", f.to);
  return out;
}

/**
 * The state a link to a week calendar carries, so its "Back to Find a space" link can
 * return to the same search: the Find a space search string as it was.
 */
export interface FromFind {
  find: string;
}

/** The Find a space search a week calendar was opened from, or null (opened some other way). */
export function fromFindState(state: unknown): string | null {
  const find = (state as Partial<FromFind> | null)?.find;
  return typeof find === "string" ? find : null;
}

/**
 * A link back to Find a space with the search it came from (every value checked again
 * by parseFindParams), on the given date, or with no date when none is given.
 */
export function findLink(search: string | null, date: string | null | undefined, site: SiteContext): string {
  const filters = parseFindParams(new URLSearchParams(search ?? ""), site, "");
  const out = writeFindParams({ ...filters, date: date ?? "" }, "").toString();
  return out ? `/find?${out}` : "/find";
}

/** How many filters in the form are set (the kind tab and the date are not filters). */
export function activeFilterCount(f: FindFilters): number {
  return (f.q.trim() ? 1 : 0) + (f.floor ? 1 : 0) + (f.minCapacity ? 1 : 0) + f.amenities.length + (f.from || f.to ? 1 : 0);
}

export const NO_FILTERS: Pick<FindFilters, "floor" | "minCapacity" | "amenities" | "q" | "from" | "to"> = {
  floor: "",
  minCapacity: "",
  amenities: [],
  q: "",
  from: "",
  to: "",
};
