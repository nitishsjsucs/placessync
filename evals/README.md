# Evals

Two evals and the end-to-end suite write JSON to `evals/results/`. Every file carries a `meta` block (git SHA, dirty flag, timestamp, command, Node and wrangler versions, OS and CPU, seed, input SHA-256). `npm run results` renders the README Results block from the committed files and refuses any file produced on a dirty tree or at a commit that is not an ancestor of `HEAD`. A test fails if the README block differs from the rendered output, so numbers cannot be edited by hand.

All runs are local: workerd through `vite preview` on one machine, and a local llama.cpp server for the LLM. No number here comes from Cloudflare's production services.

## Contention eval (`scripts/eval-contention.ts`)

```
npm run build && npm run preview     # separate terminal, port 8783
node scripts/eval-contention.ts --base-url http://localhost:8783 --runs 5 --observers 4 --control naive-d1 --out evals/results/contention.json
```

Per run: reset and seed (100 employees, 20 resources), sign in all 100 employees, open WebSocket observers (two on date A, one on date B, one on both), fire the 1,000 generated attempts at once (700 on date A, 300 on date B, each with its own Idempotency-Key and the production `Cf-Access-Jwt-Assertion` header), wait for the observers to go quiet, export the ledger, wait for the outbox to drain to D1, and compare.

| Metric | Meaning | Gate |
|---|---|---|
| `overlappingConfirmedPairs` | pairs of confirmed bookings on one resource and date that overlap | must be 0 |
| `employeeDoubleBookingPairs` | one employee holding two desks, or two rooms, at once | must be 0 |
| `unjustifiedRejections` | 409s that overlap no confirmed booking | must be 0 |
| `phantomAcceptances`, `lostAcceptances` | a 201 with no ledger row, or a ledger row with no 201 | must be 0 |
| `projectionMismatches` | D1 `reservation_facts` that differ from the ledger after the outbox drains | must be 0 |
| `observerDeltaMismatches`, `observerDateVersionGaps`, `observerForeignDateMessages`, `observerFinalStateMismatches` | each observer's deltas per date equal that date's acceptances, arrive in per-date version order, never concern a date it did not subscribe to, and rebuild the ledger exactly | must be 0 |
| `rejectedValidation`, `serverErrors` | every attempt is rule-valid, so every rejection must be a conflict | must be 0 |
| `backstopHits` | times the slot primary key caught what the overlap SELECT missed | reported |
| `latencyMs`, `wallMs`, `throughputRps` | single-machine local numbers | reported, never used as a claim |
| `control.naiveD1.overlappingPairs` | the same 1,000 attempts against a read-then-write D1 booker | must be above 0, proving the detector can see overlaps |

`accepted` varies between runs because arrival order differs.

## Triage eval (`scripts/eval-triage.ts`, classifier mode)

```
npm run llm:serve                     # separate terminal: llama-server, port 8130, 1 slot, 8,192 tokens
node scripts/eval-triage.ts --provider openai-compat --base-url http://127.0.0.1:8130/v1 --model qwen3-1.7b --set all --out evals/results/triage-qwen3-1.7b.json
node scripts/eval-triage.ts --provider stub --set all --out evals/results/triage-keyword.json
```

Sets: `templated` (200 items, 50 per category, generated from the eval template pool) and `hard` (40 items, 10 per category, in `data/triage-hard.jsonl`). The 8 few-shot examples in the prompt come from a separate template pool; a test asserts the pools share no template, subject phrase or symptom phrase. The hard set was authored during the build with AI assistance and labeled per [`triage-labeling-guide.md`](triage-labeling-guide.md); it was not written by facilities staff.

Before classifying anything with `openai-compat`, the script reads the per-slot context from llama-server's `/props`, renders every prompt with `/apply-template`, counts it with `/tokenize`, and exits non-zero if any prompt plus 160 output tokens does not fit. Each item gets up to three attempts (as in the Workflow step), then the keyword fallback. A context overflow during the run fails the run.

Reported per set: accuracy, macro-F1, per-class precision, recall and F1, the 4x4 confusion matrix (rows are the true label), schema-valid output on the first try, retry rate, keyword-fallback rate, latency p50 and p95, and the keyword baseline next to the model, so the difficulty of the synthetic set is visible. Every number is labeled with the model that produced it. No Workers AI accuracy is measured or claimed.

## Triage through the Workflow (`scripts/eval-triage.ts --mode workflow`)

```
echo TRIAGE_PROVIDER=openai-compat >> .dev.vars && npm run build && npm run preview   # vite build copies .dev.vars into dist
npm run llm:serve
node scripts/eval-triage.ts --mode workflow --app-url http://localhost:8783 --n 20 --base-url http://127.0.0.1:8130/v1 --out evals/results/triage-workflow-local.json
```

Submits the first N templated requests through `POST /api/requests` on the local server, so each one runs the real `TriageWorkflow` on Miniflare's local Workflows engine against llama-server, and waits for `awaiting_review`. It runs the same pre-flight against the llama-server the Worker calls. Reported: `reachedReview`, `providerCounts` (any `keyword-fallback` shows the LLM path failed), `categoryInEnum` (must equal N), agreement with the template label, and submit-to-review latency. Remove the `TRIAGE_PROVIDER` line and rebuild afterwards.

## End to end (`npm run test:e2e`)

Playwright (Chromium) against `npm run preview`: an axe gate on every page and on the UI kit gallery with an open Combobox and an open Dialog at 375x812 and 768x1024 (any violation fails, no rule excluded), layout checks (no horizontal scroll, 44x44 px primary controls), a keyboard-only book-and-cancel path, a two-browser live update, and live propagation latency over 20 bookings (from the booking request in one browser context to the busy cell in another; local Chromium only). `e2e/results-reporter.ts` writes `evals/results/e2e.json`.
