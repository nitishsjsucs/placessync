// The small production contention check (prod-verify): N concurrent reservation attempts
// (200 by default) for the same hour on one desk, each with its own Idempotency-Key, by the
// one identity prod-verify signs in as. The ledger must confirm exactly one; every other
// attempt must lose with a conflict (resource_conflict, or employee_conflict when the
// person already holds that hour), with no server error and no dropped response. With
// --desks 2 the attempts alternate between two desks, which also exercises the
// one-desk-at-a-time rule. Pure functions, tested in test/node/prod-verify.test.ts.
import { addBusinessDays } from "../../src/shared/time.ts";
import type { Category } from "../../src/shared/triage/categories.ts";

/**
 * The facilities requests prod-verify submits, one per category, written for this check
 * (not taken from the eval sets). A few clear requests show that Workers AI answers through
 * the Workflow; they are not an accuracy measurement.
 */
export const PROD_TRIAGE_REQUESTS: readonly { title: string; description: string; category: Category }[] = [
  {
    title: "Radiator cold in the north meeting room",
    description: "The radiator under the window in the north meeting room stays cold all morning while the heating runs elsewhere.",
    category: "building_systems",
  },
  {
    title: "Projector in room 2B will not turn on",
    description: "The ceiling projector in room 2B shows no power light and the screen stays blank when we connect a laptop.",
    category: "electrical_av",
  },
  {
    title: "Coffee spilled by the second floor stairs",
    description: "Someone spilled a large coffee on the floor next to the second floor stairs and it is slippery.",
    category: "cleaning_safety",
  },
  {
    title: "Armrest snapped off a desk chair",
    description: "The left armrest on the chair at desk 3A-04 snapped off and the chair wobbles when you sit down.",
    category: "furniture_fixtures",
  },
];

export interface AttemptOutcome {
  resourceId: string;
  status: number;
  error: string | null;
  reservationId: string | null;
  ms: number;
}

export interface ContentionResult {
  attempts: number;
  accepted: number;
  rejectedResourceConflict: number;
  rejectedEmployeeConflict: number;
  otherRejections: number;
  serverErrors: number;
  transportErrors: number;
  confirmedInWindow: number;
  latencyMs: { p50: number | null; max: number | null };
  passed: boolean;
  failures: string[];
}

export function evaluateContention(outcomes: readonly AttemptOutcome[], confirmedInWindow: number, latency: { p50: number | null; max: number | null }): ContentionResult {
  const accepted = outcomes.filter((o) => o.status === 201).length;
  const rc = outcomes.filter((o) => o.status === 409 && o.error === "resource_conflict").length;
  const ec = outcomes.filter((o) => o.status === 409 && o.error === "employee_conflict").length;
  const server = outcomes.filter((o) => o.status >= 500).length;
  const transport = outcomes.filter((o) => o.status === 0).length;
  const other = outcomes.length - accepted - rc - ec - server - transport;
  const failures: string[] = [];
  if (accepted !== 1) failures.push(`${accepted} attempts were confirmed, want exactly 1`);
  if (confirmedInWindow !== 1) failures.push(`${confirmedInWindow} confirmed bookings in the window afterwards, want exactly 1`);
  if (server > 0) failures.push(`${server} server errors`);
  if (transport > 0) failures.push(`${transport} attempts got no response`);
  if (other > 0) failures.push(`${other} attempts were rejected for another reason`);
  return {
    attempts: outcomes.length,
    accepted,
    rejectedResourceConflict: rc,
    rejectedEmployeeConflict: ec,
    otherRejections: other,
    serverErrors: server,
    transportErrors: transport,
    confirmedInWindow,
    latencyMs: latency,
    passed: failures.length === 0,
    failures,
  };
}

export interface AvailabilityRow {
  resource: { id: string; kind: string; active: boolean };
  busy: { startMin: number; endMin: number; mine: boolean }[];
}

const overlaps = (a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }) => a.startMin < b.endMin && b.startMin < a.endMin;

/**
 * The first one-hour window, on the hour, where `count` active desks are free and the
 * person holds no desk: so any rejection in the check comes from the attempts themselves.
 */
export function pickWindow(rows: readonly AvailabilityRow[], openMin: number, closeMin: number, count = 1, minutes = 60): { startMin: number; endMin: number; desks: string[] } | null {
  const desks = rows.filter((r) => r.resource.kind === "desk" && r.resource.active);
  for (let start = Math.ceil(openMin / 60) * 60; start + minutes <= closeMin; start += 60) {
    const w = { startMin: start, endMin: start + minutes };
    if (desks.some((d) => d.busy.some((b) => b.mine && overlaps(b, w)))) continue;
    const free = desks.filter((d) => !d.busy.some((b) => overlaps(b, w)));
    if (free.length >= count) return { ...w, desks: free.slice(0, count).map((d) => d.resource.id) };
  }
  return null;
}

/** Two business days out: inside the 14-day horizon, never today, never a weekend. */
export function checkDate(siteToday: string): string {
  return addBusinessDays(siteToday, 2);
}
