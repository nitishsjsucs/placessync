// The staff page's "work at a glance" strip (VIZ-01): for each stage that needs staff,
// how many requests are there and how long the oldest has waited. Pure, so it is tested
// without rendering. Every age comes from the server's clock, never the browser's: queue
// rows carry ageMinutes, and the other lists are measured against a "now" rebuilt from
// those rows (createdAt + ageMinutes), so a wrong clock on the staff member's laptop
// cannot make a request look older or newer than it is.
import type { StaffQueueResponse } from "../../shared/api.ts";

export type QueueItem = StaffQueueResponse["requests"][number];

/** The server's LIMIT on each staff list (listStaffQueue). A full list may have more. */
export const LIST_LIMIT = 200;
/** A review waits at most this long before the Workflow flags it overdue (SPEC 6). */
export const OVER_DAY_MINUTES = 24 * 60;

export type TileId = "suggested" | "manual" | "assigned" | "in_progress";

export interface SummaryTile {
  id: TileId;
  label: string;
  count: number;
  /** The list came back at the server's limit, so the count is a lower bound. */
  capped: boolean;
  /** Minutes the oldest has waited, or null when there is none. */
  oldestMinutes: number | null;
  /** "submitted": since submission (the queue's Age column); "status": since its last status change. */
  basis: "submitted" | "status";
  /** Queue tiles only: how many have waited a day or more. */
  overDay: number | null;
  to: string;
}

/** "42 min", "5 h", "11 d": the queue table's Age column. */
export function ageShort(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} d`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The same rounding as ageShort, in words for an accessible name: "11 days". */
export function ageLong(minutes: number): string {
  if (minutes < 60) return plural(minutes, "minute");
  if (minutes < 48 * 60) return plural(Math.floor(minutes / 60), "hour");
  return plural(Math.floor(minutes / 1440), "day");
}

/** The server's clock when it answered, rebuilt from rows that carry ageMinutes. */
export function serverNow(rows: readonly QueueItem[]): number | null {
  let now: number | null = null;
  for (const r of rows) {
    const t = Date.parse(r.createdAt) + r.ageMinutes * 60_000;
    if (Number.isFinite(t) && (now === null || t > now)) now = t;
  }
  return now;
}

function queueTile(id: "suggested" | "manual", label: string, rows: readonly QueueItem[], capped: boolean): SummaryTile {
  const ages = rows.map((r) => r.ageMinutes);
  return {
    id,
    label,
    count: rows.length,
    capped,
    oldestMinutes: ages.length ? Math.max(...ages) : null,
    basis: "submitted",
    // ageMinutes runs from submission. The Workflow's 24-hour review timer starts at the
    // suggestion, which normally lands seconds after submission, so the two agree.
    overDay: ages.filter((a) => a >= OVER_DAY_MINUTES).length,
    to: "/staff",
  };
}

function statusTile(id: "assigned" | "in_progress", label: string, rows: readonly QueueItem[]): SummaryTile {
  const now = serverNow(rows);
  let oldest: number | null = null;
  if (now !== null) {
    for (const r of rows) {
      const since = Date.parse(r.updatedAt);
      if (!Number.isFinite(since)) continue;
      const minutes = Math.max(0, Math.floor((now - since) / 60_000));
      if (oldest === null || minutes > oldest) oldest = minutes;
    }
  }
  return { id, label, count: rows.length, capped: rows.length >= LIST_LIMIT, oldestMinutes: oldest, basis: "status", overDay: null, to: "/staff?tab=working" };
}

/**
 * The four tiles in workflow order. The queue split follows the row actions exactly:
 * a "suggested" row offers Accept and Reassign; "pending" and "unavailable" rows offer
 * only Categorize (a late suggestion on an unavailable row is never shown).
 */
export function summarize(queue: readonly QueueItem[], working: readonly QueueItem[]): SummaryTile[] {
  const queueCapped = queue.length >= LIST_LIMIT;
  return [
    queueTile("suggested", "Suggestions to review", queue.filter((r) => r.triageState === "suggested"), queueCapped),
    queueTile("manual", "To categorize by hand", queue.filter((r) => r.triageState === "pending" || r.triageState === "unavailable"), queueCapped),
    statusTile("assigned", "Assigned, not started", working.filter((r) => r.status === "assigned")),
    statusTile("in_progress", "In progress", working.filter((r) => r.status === "in_progress")),
  ];
}

/** "12", or "200+" for a list the server cut at its limit. */
export function countText(tile: Pick<SummaryTile, "count" | "capped">): string {
  return tile.capped ? `${tile.count}+` : String(tile.count);
}

/** "oldest 11 d" or "oldest 3 d in this status", or null with nothing waiting. */
export function oldestText(tile: SummaryTile): string | null {
  if (tile.count === 0 || tile.oldestMinutes === null) return null;
  return `oldest ${ageShort(tile.oldestMinutes)}${tile.basis === "status" ? " in this status" : ""}`;
}

/** One sentence: "Suggestions to review: 12 requests, oldest 11 days, 10 waiting over 24 hours". */
export function tileSentence(tile: SummaryTile): string {
  const count = tile.capped ? `${tile.count} or more requests` : plural(tile.count, "request");
  const parts = [`${tile.label}: ${count}`];
  if (tile.count > 0 && tile.oldestMinutes !== null) parts.push(`oldest ${ageLong(tile.oldestMinutes)}${tile.basis === "status" ? " in this status" : ""}`);
  if (tile.overDay) parts.push(`${tile.overDay} waiting over 24 hours`);
  return parts.join(", ");
}

export function nothingWaiting(tiles: readonly SummaryTile[]): boolean {
  return tiles.every((t) => t.count === 0);
}
