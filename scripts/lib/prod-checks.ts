// The small production contention check (prod-verify): N concurrent reservation attempts
// by one signed-in person for the same time window on two desks. The ledger must confirm
// exactly one: the other attempts on that desk lose with resource_conflict, and every
// attempt on the other desk loses with resource_conflict or employee_conflict (one person
// cannot hold two desks at once). Pure functions, tested in test/node/prod-verify.test.ts.
import { addBusinessDays } from "../../src/shared/time.ts";

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
 * The first one-hour window, on the hour, where two active desks are free and the person
 * holds no desk: so any rejection in the check comes from the attempts themselves.
 */
export function pickWindow(rows: readonly AvailabilityRow[], openMin: number, closeMin: number, minutes = 60): { startMin: number; endMin: number; desks: [string, string] } | null {
  const desks = rows.filter((r) => r.resource.kind === "desk" && r.resource.active);
  for (let start = Math.ceil(openMin / 60) * 60; start + minutes <= closeMin; start += 60) {
    const w = { startMin: start, endMin: start + minutes };
    if (desks.some((d) => d.busy.some((b) => b.mine && overlaps(b, w)))) continue;
    const free = desks.filter((d) => !d.busy.some((b) => overlaps(b, w)));
    if (free.length >= 2) return { ...w, desks: [(free[0] as AvailabilityRow).resource.id, (free[1] as AvailabilityRow).resource.id] };
  }
  return null;
}

/** Two business days out: inside the 14-day horizon, never today, never a weekend. */
export function checkDate(siteToday: string): string {
  return addBusinessDays(siteToday, 2);
}
