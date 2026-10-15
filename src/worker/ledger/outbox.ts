// Transactional outbox flush (SPEC 6.1, 7.1, ADR 0003). Each committed mutation wrote
// one outbox row in its own transaction; the alarm copies them to D1 with upserts
// guarded by ledger_version, so replays and reordering are harmless.
import { D1_QUERIES_PER_INVOCATION } from "../free-plan.ts";

export interface FactPayload {
  reservationId: string;
  siteId: string;
  resourceId: string;
  resourceKind: "desk" | "room";
  employeeId: string;
  date: string;
  startMin: number;
  endMin: number;
  attendees: number;
  status: "confirmed" | "cancelled";
  createdAt: string;
  cancelledAt: string | null;
  ledgerVersion: number;
}

/**
 * Outbox rows per flush. A flush is one alarm invocation sending one D1 batch of
 * FLUSH_BATCH upserts plus the projection_state upsert. On Workers Free D1 allows 50
 * queries per invocation and counts each statement in a batch, so 40 + 1 = 41.
 */
export const FLUSH_BATCH = 40;
if (FLUSH_BATCH + 1 > D1_QUERIES_PER_INVOCATION) throw new Error("FLUSH_BATCH exceeds the Workers Free D1 query budget");
export const MAX_BACKOFF_MS = 60_000;

/** Backoff after the n-th consecutive failure: min(2^n s, 60 s). */
export function flushBackoffMs(failures: number): number {
  return Math.min(2 ** failures * 1000, MAX_BACKOFF_MS);
}

const UPSERT_FACT = `
INSERT INTO reservation_facts (reservation_id, site_id, resource_id, resource_kind, employee_id, date, start_min, end_min,
                               attendees, status, created_at, cancelled_at, ledger_version, projected_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(reservation_id) DO UPDATE SET
  status = excluded.status, cancelled_at = excluded.cancelled_at,
  ledger_version = excluded.ledger_version, projected_at = excluded.projected_at
WHERE excluded.ledger_version > reservation_facts.ledger_version`;

const UPSERT_STATE = `
INSERT INTO projection_state (site_id, max_ledger_version, updated_at) VALUES (?, ?, ?)
ON CONFLICT(site_id) DO UPDATE SET
  max_ledger_version = MAX(projection_state.max_ledger_version, excluded.max_ledger_version),
  updated_at = excluded.updated_at`;

export function projectionStatements(db: D1Database, siteId: string, facts: readonly FactPayload[], projectedAt: string): D1PreparedStatement[] {
  const stmts = facts.map((f) =>
    db
      .prepare(UPSERT_FACT)
      .bind(
        f.reservationId,
        f.siteId,
        f.resourceId,
        f.resourceKind,
        f.employeeId,
        f.date,
        f.startMin,
        f.endMin,
        f.attendees,
        f.status,
        f.createdAt,
        f.cancelledAt,
        f.ledgerVersion,
        projectedAt,
      ),
  );
  const maxVersion = facts.reduce((m, f) => Math.max(m, f.ledgerVersion), 0);
  stmts.push(db.prepare(UPSERT_STATE).bind(siteId, maxVersion, projectedAt));
  return stmts;
}
