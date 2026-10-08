// Pure per-date live state (SPEC 7.2, ADR 0007). A delta for date d applies only when
// dateVersion = last[d] + 1; an older or equal version is a duplicate; a bigger jump is
// a gap and d is re-subscribed for a fresh snapshot. ledgerVersion is never used for
// gap detection, so bookings on other dates cause nothing.
import type { BusyInterval } from "../../shared/api.ts";
import type { DeltaMessage, SnapshotMessage } from "../../shared/live-protocol.ts";

export interface DateState {
  dateVersion: number;
  ledgerVersion: number;
  busy: Record<string, BusyInterval[]>;
}

export type LiveState = Record<string, DateState>;

export type ApplyResult = { state: LiveState; resubscribe: string | null; applied: boolean };

export function applySnapshot(state: LiveState, msg: SnapshotMessage): LiveState {
  return { ...state, [msg.date]: { dateVersion: msg.dateVersion, ledgerVersion: msg.ledgerVersion, busy: msg.busy } };
}

export function applyDelta(state: LiveState, msg: DeltaMessage): ApplyResult {
  const current = state[msg.date];
  if (!current) return { state, resubscribe: null, applied: false };
  if (msg.dateVersion <= current.dateVersion) return { state, resubscribe: null, applied: false };
  if (msg.dateVersion > current.dateVersion + 1) return { state, resubscribe: msg.date, applied: false };
  const list = current.busy[msg.resourceId] ?? [];
  const next =
    msg.op === "booked"
      ? [...list, { startMin: msg.startMin, endMin: msg.endMin, mine: msg.mine }].sort((a, b) => a.startMin - b.startMin)
      : list.filter((b) => !(b.startMin === msg.startMin && b.endMin === msg.endMin));
  return {
    state: { ...state, [msg.date]: { dateVersion: msg.dateVersion, ledgerVersion: msg.ledgerVersion, busy: { ...current.busy, [msg.resourceId]: next } } },
    resubscribe: null,
    applied: true,
  };
}
