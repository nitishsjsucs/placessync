# 0001. One SiteLedger Durable Object per site, not per resource

Status: accepted (2026-10-08)

## Context

Reservations must never overlap on a resource, and an employee may hold at most one desk and one room at any moment. The second rule spans resources, so a per-resource object could not check it in one transaction.

## Decision

One `SiteLedger` Durable Object per site (`getByName(siteId)`) is the only writer of reservations for that site. Every booking and cancellation runs in one synchronous `transactionSync` inside it. The site id is checked against the configured site before any `getByName` call (`ledgerFor`, SPEC 7.5).

## Consequences

- Per-employee and per-resource invariants are checked in the same transaction.
- One object is a throughput ceiling (documented soft limit: about 1,000 requests per second per object). 100 employees are far below it; more sites shard by `siteId`.
- The ledger is the source of truth; D1 holds a projection (ADR 0003).
