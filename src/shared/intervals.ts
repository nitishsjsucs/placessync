// Half-open minute intervals [startMin, endMin). Adjacent intervals (a.end == b.start)
// do not overlap.

export interface Interval {
  startMin: number;
  endMin: number;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

/** Sorted union of the given intervals; touching intervals are joined. */
export function mergeIntervals(list: readonly Interval[]): Interval[] {
  const sorted = list
    .filter((i) => i.endMin > i.startMin)
    .map((i) => ({ startMin: i.startMin, endMin: i.endMin }))
    .sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.startMin <= last.endMin) last.endMin = Math.max(last.endMin, i.endMin);
    else out.push(i);
  }
  return out;
}

/** The gaps in [openMin, closeMin) not covered by busy. */
export function freeWindows(busy: readonly Interval[], openMin: number, closeMin: number): Interval[] {
  const out: Interval[] = [];
  let cursor = openMin;
  for (const b of mergeIntervals(busy)) {
    if (b.endMin <= openMin || b.startMin >= closeMin) continue;
    if (b.startMin > cursor) out.push({ startMin: cursor, endMin: Math.min(b.startMin, closeMin) });
    cursor = Math.max(cursor, b.endMin);
  }
  if (cursor < closeMin) out.push({ startMin: cursor, endMin: closeMin });
  return out;
}

/** Whether [startMin, endMin) lies entirely inside one free window. */
export function fitsWindow(free: readonly Interval[], want: Interval): boolean {
  return free.some((f) => f.startMin <= want.startMin && want.endMin <= f.endMin);
}

/**
 * Number of unordered pairs (i, j) whose intervals overlap. Callers group by resource
 * and date first. Sorting by start makes "j starts before i ends" the overlap test.
 */
export function countOverlappingPairs(list: readonly Interval[]): number {
  const sorted = list.slice().sort((a, b) => a.startMin - b.startMin);
  let pairs = 0;
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i] as Interval;
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j] as Interval;
      if (b.startMin >= a.endMin) break;
      if (b.endMin > b.startMin && a.endMin > a.startMin) pairs++;
    }
  }
  return pairs;
}

/** Groups items by key, then counts overlapping pairs inside each group. */
export function countOverlappingPairsBy<T extends Interval>(items: readonly T[], key: (item: T) => string): number {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const g = groups.get(k);
    if (g) g.push(it);
    else groups.set(k, [it]);
  }
  let total = 0;
  for (const g of groups.values()) total += countOverlappingPairs(g);
  return total;
}
