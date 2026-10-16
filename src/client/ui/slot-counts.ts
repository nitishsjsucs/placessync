// Free-space counts per time column for SlotGrid's showFreeCounts (VIZ-04). Not part of
// the kit's exports. A column counts a row as "startable" when the shortest booking for
// that row (minSlotsFor cells) can start there: every one of those cells is free, not
// past and inside open hours, which is the same rule a first click uses (paddedFrom). So
// a counted time always books when tapped, and a lone free half hour on a desk (which
// needs an hour) is not counted.

export interface CountRow {
  id: string;
  label: string;
  busy: readonly { startMin: number; endMin: number }[];
}

export interface ColumnCount {
  startMin: number;
  /** Rows on screen. */
  total: number;
  /** Rows where a minimum-length booking can start at this column. */
  startable: number;
  /** Every row's earliest start is after this column (today's elapsed time). */
  past: boolean;
}

export interface CountRules {
  slotMinutes: number;
  minStartFor?: (rowId: string) => number;
  minSlotsFor?: (rowId: string) => number;
  rowUnavailable?: (rowId: string) => string | null;
}

function busyAt(row: CountRow, start: number, end: number): boolean {
  return row.busy.some((b) => b.startMin < end && start < b.endMin);
}

/** Whether the cell at column c can be part of a new booking in this row. */
export function cellOpen(row: CountRow, c: number, slots: readonly number[], rules: CountRules): boolean {
  const m = slots[c];
  if (m === undefined) return false;
  if (rules.rowUnavailable?.(row.id)) return false;
  if (m < (rules.minStartFor?.(row.id) ?? -1)) return false;
  return !busyAt(row, m, m + rules.slotMinutes);
}

/** Whether the shortest booking for this row can start at column c. */
export function startableAt(row: CountRow, c: number, slots: readonly number[], rules: CountRules): boolean {
  const n = Math.max(1, rules.minSlotsFor?.(row.id) ?? 1);
  if (c + n > slots.length) return false;
  for (let k = c; k < c + n; k++) if (!cellOpen(row, k, slots, rules)) return false;
  return true;
}

/** The end of the run of open cells that starts at column c (minutes). */
export function freeUntil(row: CountRow, c: number, slots: readonly number[], rules: CountRules): number {
  let k = c;
  while (k < slots.length && cellOpen(row, k, slots, rules)) k++;
  return (slots[Math.max(c, k - 1)] as number) + rules.slotMinutes;
}

export function startableCounts(rows: readonly CountRow[], slots: readonly number[], rules: CountRules): ColumnCount[] {
  return slots.map((startMin, c) => ({
    startMin,
    total: rows.length,
    startable: rows.filter((r) => startableAt(r, c, slots, rules)).length,
    past: rows.length > 0 && rows.every((r) => startMin < (rules.minStartFor?.(r.id) ?? -1)),
  }));
}

/** "14:30, 1 of 14 spaces can be booked from this time", or "14:30, past". */
export function countSentence(time: string, count: ColumnCount): string {
  if (count.past) return `${time}, past`;
  return `${time}, ${count.startable} of ${count.total} ${count.total === 1 ? "space" : "spaces"} can be booked from this time`;
}

/** The visible words under a time: "3 free" or "Past" (never "Full": 0 can mean too near closing). */
export function countWords(count: ColumnCount): string {
  return count.past ? "Past" : `${count.startable} free`;
}
