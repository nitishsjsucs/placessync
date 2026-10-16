// Today's bookings as one row per space (VIZ-02), for the facilities staff question
// "which rooms and desks are in use now, and when is the next free gap?". Pure, so the
// ordering, the live reconciliation and every sentence are tested without rendering.
//
// The bookings come from GET /api/staff/bookings (the ledger, with names). Once the live
// socket's snapshot for today exists, it is authoritative for which intervals exist: a
// fetched booking it no longer has was released and is dropped, and an interval it has
// that the fetch did not is drawn as a nameless "Booked" bar until a refetch brings the
// name (the caller throttles that refetch).
import type { BusyInterval, StaffBookingsResponse } from "../../shared/api.ts";
import { formatMinutes } from "../../shared/time.ts";

export type StaffBooking = StaffBookingsResponse["bookings"][number];
export interface Space {
  id: string;
  name: string;
  kind: "desk" | "room";
  active: boolean;
}

export interface Bar {
  key: string;
  startMin: number;
  endMin: number;
  /** Null for an interval seen live before the refetch named it. */
  booking: StaffBooking | null;
}

export interface TimelineRow {
  space: Space;
  bars: Bar[];
}

export interface Built {
  rows: TimelineRow[];
  /** Live intervals with no fetched booking yet: the caller should refetch (throttled). */
  unnamed: number;
}

const byName = new Intl.Collator("en", { numeric: true });

/** Rooms first, then desks, each by name. The order never depends on time, so rows never jump. */
export function compareSpaces(a: Space, b: Space): number {
  if (a.kind !== b.kind) return a.kind === "room" ? -1 : 1;
  return byName.compare(a.name, b.name);
}

export function buildRows(resources: readonly Space[] | undefined, bookings: readonly StaffBooking[], liveBusy: Record<string, readonly BusyInterval[]> | null): Built {
  const spaces = new Map<string, Space>();
  for (const r of resources ?? []) spaces.set(r.id, r);
  // A server without the resources field, or a booking on a space it did not list.
  for (const b of bookings) if (!spaces.has(b.resourceId)) spaces.set(b.resourceId, { id: b.resourceId, name: b.resourceName, kind: b.kind, active: true });

  let unnamed = 0;
  const rows = [...spaces.values()].sort(compareSpaces).map((space) => {
    const fetched = bookings.filter((b) => b.resourceId === space.id);
    let bars: Bar[];
    if (liveBusy === null) {
      bars = fetched.map((b) => ({ key: b.id, startMin: b.startMin, endMin: b.endMin, booking: b }));
    } else {
      const live = liveBusy[space.id] ?? [];
      const matched = new Set<string>();
      bars = [];
      for (const b of fetched) {
        if (live.some((i) => i.startMin === b.startMin && i.endMin === b.endMin)) {
          bars.push({ key: b.id, startMin: b.startMin, endMin: b.endMin, booking: b });
          matched.add(`${b.startMin}-${b.endMin}`);
        }
      }
      for (const i of live) {
        if (matched.has(`${i.startMin}-${i.endMin}`)) continue;
        unnamed++;
        bars.push({ key: `live-${space.id}-${i.startMin}-${i.endMin}`, startMin: i.startMin, endMin: i.endMin, booking: null });
      }
    }
    bars.sort((a, b) => a.startMin - b.startMin);
    return { space, bars };
  });
  return { rows, unnamed };
}

const fmt = formatMinutes;

export function isOpen(nowMin: number, openMin: number, closeMin: number): boolean {
  return nowMin >= openMin && nowMin < closeMin;
}

/**
 * What a space is doing now, as one clause or two: "in use until 10:30 (Fatima Bhatt);
 * next free 10:30 to 12:30", "free now until 12:30", "free for the rest of the day",
 * "closed now; next booking 07:30" before opening, or "closed now".
 */
export function summarize(row: TimelineRow, nowMin: number, openMin: number, closeMin: number): string {
  const bars = row.bars;
  if (nowMin < openMin) {
    const first = bars[0];
    return first ? `closed now; next booking ${fmt(first.startMin)}` : "closed now";
  }
  if (nowMin >= closeMin) return "closed now";
  const current = bars.find((b) => b.startMin <= nowMin && nowMin < b.endMin);
  if (current) {
    // The end of the run of back-to-back bookings that starts with this one.
    let runEnd = current.endMin;
    for (const b of bars) if (b.startMin > current.startMin && b.startMin <= runEnd) runEnd = Math.max(runEnd, b.endMin);
    const head = `in use until ${fmt(current.endMin)} (${current.booking?.employeeName ?? "booked"})`;
    if (runEnd >= closeMin) return `${head}; no free time left today`;
    const next = bars.find((b) => b.startMin >= runEnd);
    return next ? `${head}; next free ${fmt(runEnd)} to ${fmt(next.startMin)}` : `${head}; free from ${fmt(runEnd)} for the rest of the day`;
  }
  const next = bars.find((b) => b.startMin > nowMin);
  return next ? `free now until ${fmt(next.startMin)}` : "free for the rest of the day";
}

export function inUse(row: TimelineRow, nowMin: number): boolean {
  return row.bars.some((b) => b.startMin <= nowMin && nowMin < b.endMin);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Now: 4 of 6 rooms and 9 of 14 desks in use." or, outside open hours, the day's count. */
export function headline(rows: readonly TimelineRow[], nowMin: number, openMin: number, closeMin: number): string {
  const total = rows.reduce((n, r) => n + r.bars.length, 0);
  if (nowMin < openMin) return `Opens at ${fmt(openMin)}. ${plural(total, "booking")} today.`;
  if (nowMin >= closeMin) return `Closed now. ${plural(total, "booking")} today.`;
  const count = (kind: "room" | "desk") => {
    const of = rows.filter((r) => r.space.kind === kind);
    return `${of.filter((r) => inUse(r, nowMin)).length} of ${plural(of.length, kind)}`;
  };
  return `Now: ${count("room")} and ${count("desk")} in use.`;
}

export function ended(bar: Bar, nowMin: number | null): boolean {
  return nowMin !== null && bar.endMin <= nowMin;
}

function details(bar: Bar): string[] {
  const b = bar.booking;
  if (!b) return ["Booked"];
  const out = [b.employeeName];
  if (b.kind === "room") out.push(`${b.attendees} attending`);
  if (b.title) out.push(b.title);
  return out;
}

/** "Alder, 12:30 to 13:30, Zara Haddad, 3 attending, Team sync" (", ended" once it is over). */
export function barText(space: Space, bar: Bar, nowMin: number | null): string {
  return [space.name, `${fmt(bar.startMin)} to ${fmt(bar.endMin)}`, ...details(bar), ...(ended(bar, nowMin) ? ["ended"] : [])].join(", ");
}

export interface OpenRequestRef {
  id: string;
  status: string;
  resourceId: string | null;
}

/** The space's whole row in words, for its accessible name. */
export function rowSentence(row: TimelineRow, nowMin: number | null, summary: string, openRequests: number): string {
  const name = `${row.space.name}${row.space.active ? "" : " (inactive)"}`;
  const booked = row.bars.length
    ? `booked ${row.bars.map((b) => `${fmt(b.startMin)} to ${fmt(b.endMin)} (${[...details(b), ...(ended(b, nowMin) ? ["ended"] : [])].join(", ")})`).join(", ")}`
    : "no bookings today";
  return [`${name}: ${booked}`, summary, ...(openRequests ? [plural(openRequests, "open request")] : [])].join("; ");
}

/** Where a row's open-request flag links: the request itself, or the tab that lists several. */
export function openRequestLink(requests: readonly OpenRequestRef[]): string | null {
  if (requests.length === 0) return null;
  if (requests.length === 1) return `/requests/${(requests[0] as OpenRequestRef).id}`;
  const working = requests.some((r) => r.status === "assigned" || r.status === "in_progress");
  return working ? "/staff?tab=working" : "/staff";
}

/** The left edge and width of a span inside open hours, as percentages of the track. */
export function place(startMin: number, endMin: number, openMin: number, closeMin: number): { left: number; width: number } {
  const span = closeMin - openMin;
  const s = Math.max(openMin, Math.min(closeMin, startMin));
  const e = Math.max(openMin, Math.min(closeMin, endMin));
  return { left: ((s - openMin) / span) * 100, width: ((e - s) / span) * 100 };
}

/** Whether a name fits inside a bar of this many minutes on the narrowest track (px per minute). */
export function labelFits(text: string, minutes: number, pxPerMinute: number): boolean {
  return minutes * pxPerMinute - 2 >= text.length * 7 + 12;
}
