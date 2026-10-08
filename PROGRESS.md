# PROGRESS

Build log for PlacesSync v1, built from `SPEC.md` (revision 2). A later agent continues from this file, so it is kept accurate at every commit.

## Commit plan position

Last completed commit: 6 of 32 (auth: Access verifier, dev keys, dev login, fail-closed config).
Next: commit 7 (me and resource search routes with RBAC, site allowlist and ledgerFor guard test).

## Status at the last commit

| Check | Status |
|---|---|
| `npm run types:check` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass (8 files, 99 tests) |
| `npm run build` | pass |

## Done

1. Scaffold: Vite React app, Worker entry with placeholder `SiteLedger` and `TriageWorkflow` classes, `wrangler.jsonc` with local and production environments and the cron trigger, strict tsconfig references, `.dev.vars.example`, generated `worker-configuration.d.ts`.
2. Vitest projects `worker`, `worker-ws` (one worker, no isolation, `groupOrder: 1`), `ui` (jsdom with a `matchMedia` stub), `node`; every test var pinned through `miniflare.bindings` with a fresh RS256 key per run; `env-pins.test.ts`; CI `verify` job.
3. `src/shared/rng.ts` (mulberry32 and helpers), `time.ts` (Intl site clock, business days, slots), `intervals.ts` (overlap, merge, free windows, pair counting), `rules.ts` (all SPEC 7.1 rules driven by `SiteRules`), with `rules.test.ts` and `shared-helpers.test.ts`.
4. `src/shared/synthetic/`: 100 employees (92/6/2, department split), the fixed 20-resource table, disjoint `eval` and `fewshot` request template pools, 200 labeled eval requests and 40 seed requests; `roles.ts`, `triage/categories.ts`; SHA-256 pins asserted in workerd (`synthetic.test.ts`) and Node (`generators-node.test.ts`). The contention generator lands with commit 13 and the history generator with Tier 2 commit 29, as the commit plan orders.
5. `migrations/0001_catalog.sql`, `0002_reporting.sql`, `0003_facilities.sql` exactly as SPEC 6.1; `migrations.test.ts` checks tables, views, report hours, the absent naive table and the one-review-event index.
6. `config.ts` (zod, rejects `SET_ME` and `REPLACE_WITH` placeholders, non-Access hosts, unknown modes), `auth/access-verifier.ts` (jose RS256, iss, aud, exp, 30 s tolerance; `makeVerifierFactory({ fetchImpl })` passes `[customFetch]`), `auth/dev-tokens.ts`, `auth/middleware.ts` (config, same-origin, dev-only, authenticate, requireRole, requireKnownSite), `createApp(deps)` with per-app memoized verifiers, `/api/health`, `/api/me`, `/api/dev/users|login|logout|seed` (seed writes the D1 catalog), `scripts/dev-keys.ts`; `config.test.ts`, `auth.test.ts` (dev and access modes).

## Deviations from SPEC.md

1. Ports. This machine runs other builds at the same time and this repo may only use port 8783 for the local Worker server (inspector 9233) and port 8130 for llama-server. So `npm run preview` uses `--port 8783` (spec: 8788), `seed:local` points at 8783, and `llm:serve` runs `--port 8130 -c 8192 -np 1 -ngl 99` (spec: port 8080, `-c 16384 -np 4`). The local `LLM_BASE_URL` var is `http://127.0.0.1:8130/v1`. With `-np 1 -c 8192` the per-slot context is 8,192 tokens and eval concurrency is 1; the triage eval pre-flight still reads `n_ctx` and `total_slots` from `/props`, so it adapts.

## Notes for the next agent

- Node 25.9.0 locally; `jsdom@30.1.2` prints an EBADENGINE warning on Node 25 (it lists `^22.22.2 || ^24.15.0 || >=26`). Install still succeeds.
