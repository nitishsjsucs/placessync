// Message handling for the contention eval's live observers (SPEC 13.1), kept apart from
// the socket so the gap, duplicate and resubscribe paths are unit tested
// (test/node/observer-model.test.ts).
//
// Deltas are handled the way the client handles them (SPEC 7.2): a delta for date d is
// applied when its dateVersion is last[d] + 1, ignored and counted when it is not newer,
// and a bigger jump is a gap that resubscribes d for a fresh snapshot. The eval gates
// gaps, resubscribes and duplicates at 0, so this path exists to measure a protocol fault,
// not to hide one.

export interface Busy {
  startMin: number;
  endMin: number;
}

export type ServerMessage = Record<string, unknown> & { type: string; date?: string };

export class ObserverModel {
  readonly dates: readonly string[];
  readonly last: Record<string, number> = {};
  readonly busy: Record<string, Record<string, Busy[]>> = {};
  /** Delta messages received per subscribed date (applied or not). */
  readonly deltas: Record<string, number> = {};
  gaps = 0;
  resubscribes = 0;
  duplicates = 0;
  foreign = 0;
  errors = 0;
  private readonly resyncing = new Set<string>();

  constructor(dates: readonly string[]) {
    this.dates = dates;
  }

  /** Applies one server message. Returns the date to resubscribe after a gap, or null. */
  handle(msg: ServerMessage): { resubscribe: string | null; snapshot: string | null } {
    const none = { resubscribe: null, snapshot: null };
    if (msg.date && !this.dates.includes(msg.date)) {
      this.foreign++;
      return none;
    }
    if (msg.type === "snapshot" && msg.date) {
      const d = msg.date;
      this.last[d] = Number(msg.dateVersion);
      this.busy[d] = Object.fromEntries(
        Object.entries(msg.busy as Record<string, Busy[]>).map(([r, list]) => [r, list.map((b) => ({ startMin: b.startMin, endMin: b.endMin }))]),
      );
      this.deltas[d] ??= 0; // a snapshot that answers a resubscribe keeps the count
      this.resyncing.delete(d);
      return { resubscribe: null, snapshot: d };
    }
    if (msg.type === "delta" && msg.date) {
      const d = msg.date;
      const v = Number(msg.dateVersion);
      const last = this.last[d] ?? 0;
      this.deltas[d] = (this.deltas[d] ?? 0) + 1;
      if (this.resyncing.has(d)) return none; // the coming snapshot covers it
      if (v <= last) {
        this.duplicates++;
        return none;
      }
      if (v > last + 1) {
        this.gaps++;
        this.resubscribes++;
        this.resyncing.add(d);
        return { resubscribe: d, snapshot: null };
      }
      this.last[d] = v;
      const r = String(msg.resourceId);
      const byResource = (this.busy[d] ??= {});
      const list = byResource[r] ?? [];
      if (msg.op === "booked") list.push({ startMin: Number(msg.startMin), endMin: Number(msg.endMin) });
      else {
        const i = list.findIndex((b) => b.startMin === msg.startMin && b.endMin === msg.endMin);
        if (i >= 0) list.splice(i, 1);
      }
      byResource[r] = list;
      return none;
    }
    if (msg.type === "error") this.errors++;
    return none;
  }

  /** Busy intervals for a date as sorted "resource|start|end" keys, for comparison with the ledger. */
  stateKeys(date: string): string[] {
    return Object.entries(this.busy[date] ?? {})
      .flatMap(([resourceId, list]) => list.map((b) => `${resourceId}|${b.startMin}|${b.endMin}`))
      .sort();
  }
}
