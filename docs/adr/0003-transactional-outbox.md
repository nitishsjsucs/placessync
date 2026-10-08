# 0003. Transactional outbox plus alarm for the D1 projection

Status: accepted (2026-10-08)

## Context

Reports run in D1, but a reservation commits in the Durable Object's SQLite. A post-commit write to D1 or a queue could be lost if the object is evicted between the commit and the send.

## Decision

Every committed mutation writes exactly one outbox row in the same transaction. The object's alarm flushes up to 50 rows per batch into `reservation_facts` with an upsert guarded by `ledger_version`, deletes the flushed rows, and re-arms if more remain. Failures are caught, counted in `meta.flush_failures`, and retried with backoff `min(2^n s, 60 s)`; rows are never dropped. The constructor re-arms the alarm when the outbox is non-empty.

## Consequences

- The fact row commits with the booking; replays and reordering are harmless because an older version never overwrites a newer one.
- D1 reports lag the ledger by the flush delay (250 ms locally; production alarms can be later).
- `projection.test.ts` forces a D1 failure by renaming the table and checks the counter, the backoff, and the drain after recovery.
