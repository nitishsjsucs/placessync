# 0002. Slot claims under a PRIMARY KEY in addition to an overlap SELECT

Status: accepted (2026-10-08)

## Context

An overlap `SELECT` gives a useful 409 body (the conflicting intervals), but a bug in that query would silently allow a double booking.

## Decision

Each reservation also inserts one row per 15-minute slot into `resource_slots (resource_id, date, slot)` and `employee_slots (employee_id, kind, date, slot)`, both keyed by a PRIMARY KEY, inside the same `transactionSync`. A duplicate slot throws, which rolls back the reservation row and both version bumps; the ledger records a `backstop_hits` count and answers 409.

## Consequences

- Double-claiming a slot is impossible even if the SELECT were wrong.
- `ledger.transaction.test.ts` plants a stray slot row and shows the rollback is real.
- Cancellation deletes the slot rows in the same transaction that marks the reservation cancelled.
