// 1,000 competing reservation attempts over two dates (SPEC 11.3). Date-independent:
// dayOffset 2 or 3 is resolved by the runner to the second or third business day after
// siteToday, so the output is byte-stable.
import { countOverlappingPairs, overlaps } from "../intervals.ts";
import { type Rng, intBetween, mulberry32, shuffle, weighted } from "../rng.ts";
import { slotsFor } from "../time.ts";
import { employeeId } from "./employees.ts";
import { type Resource, generateResources } from "./resources.ts";

export interface ContentionAttempt {
  attemptId: string;
  employeeId: string;
  resourceId: string;
  kind: "desk" | "room";
  dayOffset: 2 | 3;
  startMin: number;
  endMin: number;
  attendees: number;
  idempotencyKey: string;
}

export const CONTENTION_ATTEMPTS = 1000;
export const ATTEMPTS_ON_A = 700;
export const ATTEMPTS_ON_B = 300;
const ZIPF_S = 1.1;
const CLOSE_MIN = 1140;

function zipf(resources: readonly Resource[]): (readonly [Resource, number])[] {
  return resources.map((r, i) => [r, 1 / (i + 1) ** ZIPF_S] as const);
}

function startMinute(rng: Rng): number {
  if (rng() < 0.7) {
    // Peak windows: 09:00 to 11:00 or 13:00 to 15:00.
    const base = rng() < 0.5 ? 540 : 780;
    return base + intBetween(rng, 0, 7) * 15;
  }
  // Uniform 07:00 to 17:00 on 15-minute boundaries.
  return 420 + intBetween(rng, 0, 40) * 15;
}

export function generateContentionAttempts(seed: number): ContentionAttempt[] {
  const rng = mulberry32(seed ^ 0xc0ffee);
  const all = generateResources();
  const desks = zipf(all.filter((r) => r.kind === "desk"));
  const rooms = zipf(all.filter((r) => r.kind === "room"));
  const offsets = shuffle(rng, [
    ...Array.from({ length: ATTEMPTS_ON_A }, () => 2 as const),
    ...Array.from({ length: ATTEMPTS_ON_B }, () => 3 as const),
  ]);
  const out: ContentionAttempt[] = [];
  for (let i = 0; i < CONTENTION_ATTEMPTS; i++) {
    const employee = employeeId(intBetween(rng, 1, 100));
    const isDesk = rng() < 0.6;
    const resource = weighted(rng, isDesk ? desks : rooms);
    const start = startMinute(rng);
    const duration = isDesk
      ? weighted(rng, [
          [120, 0.3],
          [240, 0.4],
          [480, 0.3],
        ] as const)
      : weighted(rng, [
          [30, 0.35],
          [60, 0.35],
          [90, 0.15],
          [120, 0.15],
        ] as const);
    const attemptId = `att_${String(i + 1).padStart(4, "0")}`;
    out.push({
      attemptId,
      employeeId: employee,
      resourceId: resource.id,
      kind: resource.kind,
      dayOffset: offsets[i] as 2 | 3,
      startMin: start,
      endMin: Math.min(start + duration, CLOSE_MIN),
      attendees: isDesk ? 1 : intBetween(rng, 1, resource.capacity),
      idempotencyKey: attemptId,
    });
  }
  return out;
}

export interface ContentionStats {
  attempts: number;
  attemptsPerDate: { A: number; B: number };
  distinctEmployees: number;
  distinctResources: number;
  /** Attempts overlapping at least one other attempt on the same resource and date. */
  contestedAttempts: number;
  /** Most attempts claiming one (resource, date, slot). */
  peakSlotDemand: number;
  /** Overlapping attempt pairs by the same employee for the same kind and date. */
  employeeCollisions: number;
}

export function contentionStats(attempts: readonly ContentionAttempt[]): ContentionStats {
  const groups = new Map<string, ContentionAttempt[]>();
  const slotDemand = new Map<string, number>();
  for (const a of attempts) {
    const key = `${a.resourceId}|${a.dayOffset}`;
    const g = groups.get(key);
    if (g) g.push(a);
    else groups.set(key, [a]);
    for (const s of slotsFor(a.startMin, a.endMin)) {
      const sk = `${key}|${s}`;
      slotDemand.set(sk, (slotDemand.get(sk) ?? 0) + 1);
    }
  }
  let contested = 0;
  for (const g of groups.values()) {
    for (const a of g) if (g.some((b) => b !== a && overlaps(a, b))) contested++;
  }
  const byEmployee = new Map<string, ContentionAttempt[]>();
  for (const a of attempts) {
    const key = `${a.employeeId}|${a.kind}|${a.dayOffset}`;
    const g = byEmployee.get(key);
    if (g) g.push(a);
    else byEmployee.set(key, [a]);
  }
  let employeeCollisions = 0;
  for (const g of byEmployee.values()) employeeCollisions += countOverlappingPairs(g);
  return {
    attempts: attempts.length,
    attemptsPerDate: { A: attempts.filter((a) => a.dayOffset === 2).length, B: attempts.filter((a) => a.dayOffset === 3).length },
    distinctEmployees: new Set(attempts.map((a) => a.employeeId)).size,
    distinctResources: new Set(attempts.map((a) => a.resourceId)).size,
    contestedAttempts: contested,
    peakSlotDemand: Math.max(0, ...slotDemand.values()),
    employeeCollisions,
  };
}
