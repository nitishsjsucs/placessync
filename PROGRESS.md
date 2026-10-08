# PROGRESS

Build log for PlacesSync v1, built from `SPEC.md` (revision 2). A later agent continues from this file, so it is kept accurate at every commit.

## Commit plan position

Last completed commit: 9 of 32 (cancel, idempotency, per-employee slots, per-date versions).
Next: commit 10 (outbox and alarm projection with failure counter backoff into reservation_facts and utilization view).

## Status at the last commit

| Check | Status |
|---|---|
| `npm run types:check` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass (14 files, 156 tests) |
| `npm run build` | pass |

## Done

1. Scaffold: Vite React app, Worker entry with placeholder `SiteLedger` and `TriageWorkflow` classes, `wrangler.jsonc` with local and production environments and the cron trigger, strict tsconfig references, `.dev.vars.example`, generated `worker-configuration.d.ts`.
2. Vitest projects `worker`, `worker-ws` (one worker, no isolation, `groupOrder: 1`), `ui` (jsdom with a `matchMedia` stub), `node`; every test var pinned through `miniflare.bindings` with a fresh RS256 key per run; `env-pins.test.ts`; CI `verify` job.
3. `src/shared/rng.ts` (mulberry32 and helpers), `time.ts` (Intl site clock, business days, slots), `intervals.ts` (overlap, merge, free windows, pair counting), `rules.ts` (all SPEC 7.1 rules driven by `SiteRules`), with `rules.test.ts` and `shared-helpers.test.ts`.
4. `src/shared/synthetic/`: 100 employees (92/6/2, department split), the fixed 20-resource table, disjoint `eval` and `fewshot` request template pools, 200 labeled eval requests and 40 seed requests; `roles.ts`, `triage/categories.ts`; SHA-256 pins asserted in workerd (`synthetic.test.ts`) and Node (`generators-node.test.ts`). The contention generator lands with commit 13 and the history generator with Tier 2 commit 29, as the commit plan orders.
5. `migrations/0001_catalog.sql`, `0002_reporting.sql`, `0003_facilities.sql` exactly as SPEC 6.1; `migrations.test.ts` checks tables, views, report hours, the absent naive table and the one-review-event index.
6. `config.ts` (zod, rejects `SET_ME` and `REPLACE_WITH` placeholders, non-Access hosts, unknown modes), `auth/access-verifier.ts` (jose RS256, iss, aud, exp, 30 s tolerance; `makeVerifierFactory({ fetchImpl })` passes `[customFetch]`), `auth/dev-tokens.ts`, `auth/middleware.ts` (config, same-origin, dev-only, authenticate, requireRole, requireKnownSite), `createApp(deps)` with per-app memoized verifiers, `/api/health`, `/api/me`, `/api/dev/users|login|logout|seed` (seed writes the D1 catalog), `scripts/dev-keys.ts`; `config.test.ts`, `auth.test.ts` (dev and access modes).
7. `GET /api/sites/:siteId/resources` with kind, floor, all-of amenity, minCapacity and q filters (`src/shared/resource-filter.ts`); `requireKnownSite` on `/api/sites/:siteId/*`; `ledger/ledger-for.ts` as the single `getByName` call site with `test/node/ledger-for-guard.test.ts`; `resources.test.ts` (brute-force oracle), `rbac.test.ts` (matrix grows with each route), unknown-site cases in `auth.test.ts` assert no Durable Object is created.
8. `src/worker/ledger/schema.ts` (full DO SQLite DDL from SPEC 6.2), `site-ledger.ts` with async `reserve` (single-flight `ensureCatalog`, then one `transactionSync`: rules from the ledger `site` row, overlap SELECT, reservation INSERT, `resource_slots` PK claims; a PK violation rolls everything back and counts `backstop_hits`), `syncCatalog` by `ctx.id.name`, `availability`, `exportDay`, `resetForDev`; the dev seed resets and syncs the ledger; `ledger.reserve.test.ts`, `ledger.transaction.test.ts` (rollback, single-flight with 50 concurrent calls).
9. Ledger: idempotency by `(employee_id, key)` with a SHA-256 request hash (stored responses replay byte-identical, a different body gives `idempotency_key_reuse`), employee SELECT plus `employee_slots` PK (one desk and one room at a time per employee), `date_versions` bumped with `RETURNING` in the same transaction, `cancel` (owner or admin, confirmed, not started, frees slots); `ledger.cancel.test.ts` and new reserve and rollback cases.

## Deviations from SPEC.md

1. Ports. This machine runs other builds at the same time and this repo may only use port 8783 for the local Worker server (inspector 9233) and port 8130 for llama-server. So `npm run preview` uses `--port 8783` (spec: 8788), `seed:local` points at 8783, and `llm:serve` runs `--port 8130 -c 8192 -np 1 -ngl 99` (spec: port 8080, `-c 16384 -np 4`). The local `LLM_BASE_URL` var is `http://127.0.0.1:8130/v1`. With `-np 1 -c 8192` the per-slot context is 8,192 tokens and eval concurrency is 1; the triage eval pre-flight still reads `n_ctx` and `total_slots` from `/props`, so it adapts.

## Notes for the next agent

- Node 25.9.0 locally; `jsdom@30.1.2` prints an EBADENGINE warning on Node 25 (it lists `^22.22.2 || ^24.15.0 || >=26`). Install still succeeds.
