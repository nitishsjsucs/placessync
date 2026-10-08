// Past bookings for the reports (SPEC 11.1): the 20 business days before siteToday. The
// only date-dependent generator; its hash is pinned at HISTORY_PIN_DATE. The output obeys
// the ledger invariants (no overlap per resource, one desk and one room per employee at a
// time), and about 5% of rows are cancelled.
import { overlaps } from "../intervals.ts";
import { intBetween, mulberry32, pick, weighted } from "../rng.ts";
import { previousBusinessDays } from "../time.ts";
import { employeeId } from "./employees.ts";
import { generateResources } from "./resources.ts";

export interface HistoryRow {
  employeeId: string;
  resourceId: string;
  kind: "desk" | "room";
  date: string;
  startMin: number;
  endMin: number;
  attendees: number;
  cancelled: boolean;
}

export const HISTORY_DAYS = 20;

export function generateHistory(seed: number, siteToday: string): HistoryRow[] {
  const rng = mulberry32(seed ^ 0x415);
  const resources = generateResources();
  const rows: HistoryRow[] = [];
  for (const date of previousBusinessDays(siteToday, HISTORY_DAYS)) {
    const held = new Map<string, { startMin: number; endMin: number }[]>();
    for (const r of resources) {
      const taken: { startMin: number; endMin: number }[] = [];
      // Desks: usually one long booking or none; rooms: a few meetings.
      const tries = r.kind === "desk" ? 2 : 6;
      for (let t = 0; t < tries; t++) {
        if (rng() > (r.kind === "desk" ? 0.55 : 0.6)) continue;
        const duration = r.kind === "desk" ? weighted(rng, [[240, 0.4], [480, 0.6]] as const) : pick(rng, [30, 60, 60, 90]);
        const start = 420 + intBetween(rng, 0, (1140 - 420 - duration) / 15) * 15;
        const want = { startMin: start, endMin: start + duration };
        if (taken.some((b) => overlaps(b, want))) continue;
        const employee = employeeId(intBetween(rng, 1, 100));
        const key = `${employee}|${r.kind}`;
        if ((held.get(key) ?? []).some((b) => overlaps(b, want))) continue;
        const cancelled = rng() < 0.05;
        if (!cancelled) {
          taken.push(want);
          held.set(key, [...(held.get(key) ?? []), want]);
        }
        rows.push({ employeeId: employee, resourceId: r.id, kind: r.kind, date, ...want, attendees: r.kind === "desk" ? 1 : intBetween(rng, 1, r.capacity), cancelled });
      }
    }
  }
  return rows;
}
