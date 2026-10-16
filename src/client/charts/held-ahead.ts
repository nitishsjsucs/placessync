// Utilization split at today (VIZ-07, VIZ-06): "held" is what was booked on days that
// have passed, "ahead" is what is booked so far from today on. Mixing them gives a number
// that is neither, so every figure on the admin Utilization tab uses one or the other.
//
// A space's utilization in a part is its booked minutes over every open minute of the
// weekdays in that part. A kind's held utilization is the mean over the spaces of that
// kind that are active now, zero-booked ones included (the underused ones are exactly
// what the admin is looking for); inactive spaces are listed but left out of the mean.
// Built from the report the page already loads and the resource list it already has.
import type { Resource, UtilizationReport } from "../../shared/api.ts";
import { addDays, isWeekday } from "../../shared/time.ts";

export type Kind = "desk" | "room";

export interface PartRange {
  from: string;
  to: string;
  weekdays: number;
}

export interface PartUse {
  bookedMin: number;
  bookings: number;
  days: number;
  /** Booked minutes over open minutes; null when the part has no weekdays. */
  utilization: number | null;
}

export interface SpaceUse {
  id: string;
  name: string;
  kind: Kind;
  active: boolean;
  held: PartUse;
  ahead: PartUse;
  bookings: number;
  days: number;
}

export interface KindSummary {
  kind: Kind;
  /** Active spaces of this kind now: the denominator's space count. */
  activeSpaces: number;
  /** Mean held utilization over the active spaces; null without past weekdays or spaces. */
  heldUtilization: number | null;
  aheadUtilization: number | null;
}

export interface Split {
  held: PartRange | null;
  ahead: PartRange | null;
  spaces: SpaceUse[];
  kinds: Record<Kind, KindSummary>;
  /** Confirmed bookings from today to the end of the range. */
  bookedAhead: number;
  cancelled: number;
  /** Confirmed plus cancelled bookings in the whole range. */
  allBookings: number;
}

export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d)) n++;
  return n;
}

/** The weekdays from `from` to `to`, oldest first. */
export function weekdayList(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d)) out.push(d);
  return out;
}

function part(from: string, to: string): PartRange | null {
  return from <= to ? { from, to, weekdays: weekdaysBetween(from, to) } : null;
}

const empty = (): PartUse => ({ bookedMin: 0, bookings: 0, days: 0, utilization: null });

function rate(bookedMin: number, range: PartRange | null, openMinutesPerDay: number): number | null {
  if (!range || range.weekdays === 0 || openMinutesPerDay <= 0) return null;
  return bookedMin / (range.weekdays * openMinutesPerDay);
}

export function splitAtToday(report: UtilizationReport, resources: readonly Pick<Resource, "id" | "name" | "kind" | "active">[], today: string, range: { from: string; to: string }): Split {
  const held = part(range.from, range.to < today ? range.to : addDays(today, -1));
  const ahead = part(range.from > today ? range.from : today, range.to);
  const open = report.totals.openMinutesPerDay;

  const byId = new Map<string, SpaceUse>();
  const add = (r: { id: string; name: string; kind: Kind; active: boolean }) => {
    const s: SpaceUse = { ...r, held: empty(), ahead: empty(), bookings: 0, days: 0 };
    byId.set(r.id, s);
    return s;
  };
  for (const r of resources) add({ id: r.id, name: r.name, kind: r.kind, active: r.active });
  for (const row of report.rows) {
    if (row.date < range.from || row.date > range.to) continue;
    // A space missing from the list (it should not be: the list includes inactive ones).
    const s = byId.get(row.resourceId) ?? add({ id: row.resourceId, name: row.name, kind: row.kind, active: true });
    const p = row.date < today ? s.held : s.ahead;
    p.bookedMin += row.bookedMin;
    p.bookings += row.bookings;
    p.days += 1;
    s.bookings += row.bookings;
    s.days += 1;
  }
  const spaces = [...byId.values()]
    // Inactive spaces only when they were booked in the range.
    .filter((s) => s.active || s.bookings > 0)
    .map((s) => ({ ...s, held: { ...s.held, utilization: rate(s.held.bookedMin, held, open) }, ahead: { ...s.ahead, utilization: rate(s.ahead.bookedMin, ahead, open) } }));

  const summary = (kind: Kind): KindSummary => {
    const active = spaces.filter((s) => s.kind === kind && s.active);
    const mean = (pick: (s: SpaceUse) => number | null) => {
      if (active.length === 0) return null;
      const values = active.map(pick);
      if (values.some((v) => v === null)) return null;
      return (values as number[]).reduce((a, b) => a + b, 0) / values.length;
    };
    return { kind, activeSpaces: active.length, heldUtilization: mean((s) => s.held.utilization), aheadUtilization: mean((s) => s.ahead.utilization) };
  };

  const inRange = report.daily.filter((d) => d.date >= range.from && d.date <= range.to);
  const confirmed = inRange.reduce((n, d) => n + d.confirmed, 0);
  const cancelled = inRange.reduce((n, d) => n + d.cancelled, 0);
  return {
    held,
    ahead,
    spaces,
    kinds: { desk: summary("desk"), room: summary("room") },
    bookedAhead: inRange.filter((d) => d.date >= today).reduce((n, d) => n + d.confirmed, 0),
    cancelled,
    allBookings: confirmed + cancelled,
  };
}

/** "38%": a share on the fixed 0 to 100 scale. */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/** A bar width on the fixed 0 to 100 domain (a 0.38 share is 38% of the track), capped at 100. */
export function barWidth(value: number): string {
  return `${Math.max(0, Math.min(100, Math.round(value * 1000) / 10))}%`;
}

export interface DayColumn {
  date: string;
  confirmed: number;
  cancelled: number;
  /** Today or later: bookings made so far for a day that is not over. */
  ahead: boolean;
}

/** One column per weekday in the range for a kind, zero-filled where the report has no row. */
export function dailyColumns(report: UtilizationReport, kind: Kind, range: { from: string; to: string }, today: string): DayColumn[] {
  const byDate = new Map(report.daily.filter((d) => d.resourceKind === kind).map((d) => [d.date, d]));
  return weekdayList(range.from, range.to).map((date) => {
    const d = byDate.get(date);
    return { date, confirmed: d?.confirmed ?? 0, cancelled: d?.cancelled ?? 0, ahead: date >= today };
  });
}
