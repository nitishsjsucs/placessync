# 0007. Per-date live versions for WebSocket gap detection

Status: accepted (2026-10-08)

## Context

Clients subscribe to the dates they show. With only a global version, every booking on a date a socket does not watch would look like a gap and force a resubscribe.

## Decision

Each mutation bumps `date_versions[date]` in the same transaction as the booking (an upsert with `RETURNING`). Snapshots and deltas carry `dateVersion` and the global `ledgerVersion`. Clients apply a delta only when `dateVersion` is the last one plus 1, ignore duplicates, and resubscribe that date alone on a gap. `ledgerVersion` is informational.

## Consequences

- A socket watching date A never hears about date B; the contention eval splits attempts 700 / 300 over two dates and checks observers on each, so the gap gates are not vacuous.
- `test/ws/live.test.ts` books ten times on B and shows the next delta on A is still in order.
