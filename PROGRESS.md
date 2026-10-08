# PROGRESS

Build log for PlacesSync v1, built from `SPEC.md` (revision 2). A later agent continues from this file, so it is kept accurate at every commit.

## Commit plan position

Last completed commit: 3 of 32 (shared PRNG, time, intervals, site rules).
Next: commit 4 (synthetic generators for 100 employees, 20 resources and disjoint request template pools).

## Status at the last commit

| Check | Status |
|---|---|
| `npm run types:check` | pass |
| `npm run typecheck` | pass |
| `npm test` | pass (3 files, 37 tests) |
| `npm run build` | pass |

## Done

1. Scaffold: Vite React app, Worker entry with placeholder `SiteLedger` and `TriageWorkflow` classes, `wrangler.jsonc` with local and production environments and the cron trigger, strict tsconfig references, `.dev.vars.example`, generated `worker-configuration.d.ts`.
2. Vitest projects `worker`, `worker-ws` (one worker, no isolation, `groupOrder: 1`), `ui` (jsdom with a `matchMedia` stub), `node`; every test var pinned through `miniflare.bindings` with a fresh RS256 key per run; `env-pins.test.ts`; CI `verify` job.
3. `src/shared/rng.ts` (mulberry32 and helpers), `time.ts` (Intl site clock, business days, slots), `intervals.ts` (overlap, merge, free windows, pair counting), `rules.ts` (all SPEC 7.1 rules driven by `SiteRules`), with `rules.test.ts` and `shared-helpers.test.ts`.

## Deviations from SPEC.md

1. Ports. This machine runs other builds at the same time and this repo may only use port 8783 for the local Worker server (inspector 9233) and port 8130 for llama-server. So `npm run preview` uses `--port 8783` (spec: 8788), `seed:local` points at 8783, and `llm:serve` runs `--port 8130 -c 8192 -np 1 -ngl 99` (spec: port 8080, `-c 16384 -np 4`). The local `LLM_BASE_URL` var is `http://127.0.0.1:8130/v1`. With `-np 1 -c 8192` the per-slot context is 8,192 tokens and eval concurrency is 1; the triage eval pre-flight still reads `n_ctx` and `total_slots` from `/props`, so it adapts.

## Notes for the next agent

- Node 25.9.0 locally; `jsdom@30.1.2` prints an EBADENGINE warning on Node 25 (it lists `^22.22.2 || ^24.15.0 || >=26`). Install still succeeds.
