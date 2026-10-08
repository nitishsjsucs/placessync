// The contention eval's observer message handling (scripts/lib/observer-model.ts): the
// gates on gaps, resubscribes, duplicates and foreign-date messages are only meaningful
// if these paths count what they claim to.
import { describe, expect, it } from "vitest";
import { ObserverModel } from "../../scripts/lib/observer-model.ts";

const A = "2026-10-12";
const B = "2026-10-13";

const snapshot = (date: string, dateVersion: number, busy: Record<string, { startMin: number; endMin: number }[]> = {}) => ({
  type: "snapshot",
  date,
  dateVersion,
  ledgerVersion: 0,
  busy,
});
const delta = (date: string, dateVersion: number, op: "booked" | "released", resourceId: string, startMin: number, endMin: number) => ({
  type: "delta",
  date,
  dateVersion,
  ledgerVersion: 0,
  op,
  resourceId,
  startMin,
  endMin,
  mine: false,
});

describe("ObserverModel", () => {
  it("applies in-order deltas and reconstructs busy state", () => {
    const m = new ObserverModel([A]);
    expect(m.handle(snapshot(A, 0))).toEqual({ resubscribe: null, snapshot: A });
    m.handle(delta(A, 1, "booked", "res_2a01", 540, 600));
    m.handle(delta(A, 2, "booked", "res_2a01", 600, 660));
    m.handle(delta(A, 3, "released", "res_2a01", 540, 600));
    expect(m.stateKeys(A)).toEqual(["res_2a01|600|660"]);
    expect(m.deltas[A]).toBe(3);
    expect([m.gaps, m.resubscribes, m.duplicates, m.foreign, m.errors]).toEqual([0, 0, 0, 0, 0]);
  });

  it("counts a duplicate delta and does not apply it", () => {
    const m = new ObserverModel([A]);
    m.handle(snapshot(A, 4));
    m.handle(delta(A, 5, "booked", "res_2a01", 540, 600));
    m.handle(delta(A, 5, "booked", "res_2a01", 540, 600));
    expect(m.duplicates).toBe(1);
    expect(m.stateKeys(A)).toEqual(["res_2a01|540|600"]);
    expect(m.deltas[A]).toBe(2);
  });

  it("treats a version jump as a gap, resubscribes that date only, and resyncs from the next snapshot", () => {
    const m = new ObserverModel([A, B]);
    m.handle(snapshot(A, 0));
    m.handle(snapshot(B, 0));
    expect(m.handle(delta(A, 2, "booked", "res_2a01", 540, 600))).toEqual({ resubscribe: A, snapshot: null });
    expect([m.gaps, m.resubscribes]).toEqual([1, 1]);
    // Deltas for A that arrive before the answering snapshot are covered by it.
    expect(m.handle(delta(A, 3, "booked", "res_2a02", 540, 600))).toEqual({ resubscribe: null, snapshot: null });
    // B is unaffected.
    m.handle(delta(B, 1, "booked", "res_3a01", 600, 660));
    expect(m.stateKeys(B)).toEqual(["res_3a01|600|660"]);
    // The snapshot resets A's state and version but keeps the received-delta count.
    m.handle(snapshot(A, 3, { res_2a01: [{ startMin: 420, endMin: 480 }], res_2a02: [{ startMin: 540, endMin: 600 }] }));
    expect(m.last[A]).toBe(3);
    expect(m.stateKeys(A)).toEqual(["res_2a01|420|480", "res_2a02|540|600"]);
    expect(m.deltas[A]).toBe(2);
    m.handle(delta(A, 4, "released", "res_2a02", 540, 600));
    expect(m.stateKeys(A)).toEqual(["res_2a01|420|480"]);
    expect([m.gaps, m.resubscribes, m.duplicates]).toEqual([1, 1, 0]);
  });

  it("counts messages about dates it never subscribed to, and error messages", () => {
    const m = new ObserverModel([A]);
    m.handle(snapshot(A, 0));
    m.handle(delta(B, 1, "booked", "res_2a01", 540, 600));
    m.handle({ type: "error", code: "bad_message" });
    expect(m.foreign).toBe(1);
    expect(m.errors).toBe(1);
    expect(m.deltas[B]).toBeUndefined();
    expect(m.stateKeys(A)).toEqual([]);
  });
});
