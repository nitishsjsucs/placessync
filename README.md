# PlacesSync

A workplace application for reserving desks and meeting rooms, reporting facilities issues, and following each request until it is resolved. One Cloudflare Durable Object per site is the only writer of reservations and commits every booking in a single SQLite transaction, live availability reaches browsers over hibernatable WebSockets, reporting runs on D1, and a Cloudflare Workflow suggests one of four service categories for each facilities request so staff can accept or change it.

**Status (2026-10-15).** Everything in this repository runs and is tested locally on workerd (through Miniflare and the Cloudflare Vite plugin) and in GitHub Actions CI. Production setup for Cloudflare's Workers Free plan is scripted and idempotent (`npm run prod:setup`, see [Production setup](#production-setup-not-run-yet)), but it has not been run: a read-only `npm run prod:doctor` on 2026-10-15 found no PlacesSync D1 database and no deployed Worker on the account. So nothing is deployed, the triage Workflow has never called Workers AI, and no number below comes from Cloudflare's production services. See [What runs where](#what-runs-where) and [Production on the Workers Free plan](#production-on-the-workers-free-plan).

## Why

A workplace team shares a fixed set of desks and rooms across many employees. As the office fills up, two requests race for the same desk, booking screens show availability that changed seconds ago, and facilities issues land in one inbox where someone has to read and route each one. PlacesSync treats a booking as a write to a per-site ledger that cannot double-book, pushes each committed change to every screen watching that date, and has a model suggest the service category for each issue while the decision stays with facilities staff.

## What it does

- **Find a space.** Search 20 resources (14 desks, 6 rooms) by date, time window, kind, floor, amenities, seats and free text; pick a range on a slot grid that updates live; confirm in a dialog.
- **Resource calendars.** A week view per desk or room, bookable from the grid.
- **My bookings.** Upcoming, past and cancelled bookings; cancel with an optional reason.
- **Report an issue and follow it.** Submit a facilities request; see its status, the suggested category with the provider that produced it, the final category, and a timeline.
- **Facilities staff.** A triage queue with suggestions, confidence and provider labels; accept, reassign, or categorize by hand; move work to in progress and resolved; today's bookings with names; live notifications.
- **Facilities admins.** Utilization, hourly occupancy and bookings per day from D1 reporting views; request reports with suggestion agreement shown per provider; activate, deactivate and edit resources (the ledger's catalog copy resyncs at once).
- **Synthetic data.** 100 employees (92 employees, 6 facilities staff, 2 facilities admins) and the 20 resources come from seeded generators whose output is pinned by SHA-256 in tests.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    SPA["React 19 SPA<br/>8-component UI kit"]
  end
  subgraph Edge["Cloudflare edge (production only)"]
    ACCESS["Cloudflare Access<br/>issues RS256 JWT"]
  end
  subgraph Worker["Worker: placessync"]
    ASSETS["Static assets<br/>SPA fallback"]
    API["Hono API /api/*<br/>JWT verify, RBAC, site allowlist, zod"]
    CRON["scheduled(): triage sweep<br/>cron */2 * * * *"]
  end
  subgraph DO["SiteLedger Durable Object (one per site)"]
    LEDGER["SQLite: reservations,<br/>resource_slots, employee_slots,<br/>idempotency, outbox"]
    WS["Hibernatable WebSockets<br/>availability deltas, staff events"]
    ALARM["alarm(): outbox flush"]
  end
  D1[("D1: catalog, requests,<br/>triage_suggestions,<br/>reservation_facts, report views")]
  WF["TriageWorkflow<br/>(Cloudflare Workflows)"]
  LLM{{"LlmProvider"}}
  WAI["Workers AI<br/>llama-3.3-70b JSON mode<br/>(production)"]
  LLAMA["llama-server<br/>Qwen3-1.7B GGUF<br/>(local eval)"]
  STUB["Keyword stub<br/>(tests, offline default)"]

  SPA -->|"HTTPS + Cf-Access-Jwt-Assertion"| ACCESS --> API
  SPA -.->|"local dev: CF_Authorization cookie"| API
  SPA --> ASSETS
  API -->|"RPC: reserve, cancel, availability"| LEDGER
  API -->|"WebSocket upgrade /api/sites/:id/live"| WS
  LEDGER --> WS
  LEDGER --> ALARM
  ALARM -->|"batch upsert, version-guarded"| D1
  API -->|"catalog, requests, reports"| D1
  API -->|"create(id = requestId), sendEvent"| WF
  CRON -->|"stranded 'submitted' rows: create or restart"| WF
  WF -->|"load, record suggestion"| D1
  WF -->|"notifyStaff RPC"| WS
  WF --> LLM
  LLM --> WAI
  LLM --> LLAMA
  LLM --> STUB
```

How a booking is kept safe:

1. The Worker verifies the token, loads the employee and role from D1, validates the body with zod, and resolves the site from the D1 resource row (404 before any Durable Object call). Durable Object names never come from a request: `ledgerFor` allows only the configured site, and a test fails if `getByName(` appears anywhere else under `src/worker`.
2. The `SiteLedger` loads its catalog once (single-flight), then runs one `transactionSync` with no `await` inside: idempotency lookup, the shared booking rules, an overlap `SELECT` on the resource, an overlap `SELECT` on the employee, the reservation insert, one `resource_slots` and one `employee_slots` row per 15-minute slot under PRIMARY KEYs, the ledger and per-date version bumps, an outbox row and the idempotency record. A duplicate slot throws and rolls everything back.
3. After commit the object sends a delta to sockets subscribed to that date and arms its alarm, which copies outbox rows to D1 with upserts guarded by version.

Design decisions are recorded in [`docs/adr/`](docs/adr) (one ledger per site, slot claims, the outbox, explicit Access verification, the Vitest integration, the Workflow, per-date live versions, the triage sweep). The domain vocabulary is in [`CONTEXT.md`](CONTEXT.md). The pre-build design is [`SPEC.md`](SPEC.md); where the build differs from it (ports, llama-server slots and the rest), [`PROGRESS.md`](PROGRESS.md) lists each deviation and the reason.

## What runs where

| Capability | Local (this Mac; GitHub Actions CI where noted) | Production (after `npm run prod:setup`, which has not been run) |
|---|---|---|
| Worker and Hono API | workerd via `vite dev` / `vite preview`; tests via `@cloudflare/vitest-plugin` (this Mac and CI) | Cloudflare Workers Free plan: Worker `placessync-production` at `https://placessync-production.nitish-ratakonda.workers.dev` (workers.dev only, preview URLs off) |
| Static SPA | Vite build served by local workerd assets | Workers static assets |
| SiteLedger (DO SQLite, transactions, alarms, WebSocket hibernation) | Miniflare local Durable Objects, persisted in `.wrangler/state/v3` | Durable Objects (SQLite backend). Alarms may be delayed up to a minute in production, so D1 reports lag more than locally. |
| D1 | local SQLite via Miniflare | D1 database `placessync` |
| Workflows | local emulated engine (Cloudflare's docs say local behaviour may differ; the local "already exists" and "not found" error texts are Miniflare's) | Cloudflare Workflows, `placessync-triage` |
| Cron triage sweep | `scheduled()` called directly in tests via `createScheduledController`; not fired on a timer during local dev | Cron Trigger `*/2 * * * *` on `placessync-production` |
| Triage LLM | `stub` (keyword-v1, not an LLM) by default and always in `npm test` (this Mac and CI); `openai-compat` against llama-server with Qwen3-1.7B Q4_0 (8,192 tokens per slot, 1 slot) for evals, this Mac only (CI runs no LLM); seeded suggestions are stub output and labeled so | Workers AI `@cf/meta/llama-3.3-70b-instruct-fp8-fast` in JSON mode, inside the Free plan's 10,000 neurons a day that this account shares with three other apps; optional AI Gateway |
| Auth | `jose` verifying RS256 tokens signed by a locally generated dev key; dev login page; cookie or header | Cloudflare Access (Zero Trust Free, team `old-truth-a7dc`): a self-hosted application for the workers.dev hostname, the account's One-time PIN login only, an Allow policy for the owner and two persona addresses, and a Service Auth policy for the verification service token; JWKS from `https://old-truth-a7dc.cloudflareaccess.com/cdn-cgi/access/certs`; header only |
| Contention eval | local workerd, single machine, numbers labeled local. This Mac: 5 runs, the numbers in Results. CI: 1 run as a pass/fail gate, not reported | `npm run prod:verify`: 200 concurrent attempts for one hour on one desk, through Access with the service token; a pass/fail check, not a load test. Not run yet; nothing claimed |
| Triage eval | Qwen3-1.7B via llama.cpp, labeled with the model; this Mac only, CI runs no triage eval | `npm run prod:verify`: 3 requests through the Workflow, each must get a Workers AI suggestion; a sanity check, not an accuracy measurement. Not run yet; no Workers AI accuracy is claimed |
| CPU time | not meaningful locally | `npm run prod:verify` measures it (wrangler tail and GraphQL analytics) against the Free plan's 10 ms. Not run yet |
| PITR, location hints, AI Gateway analytics | unavailable | available, unused in v1 |

No local stand-in is the production service. In particular:

- **Access is simulated locally.** The dev login signs a token with a key generated on this machine; the same verifier then checks it. Tests also run the production code path against a fake team JWKS, including a service-token token (no email, the Client ID as `common_name`). This proves the verifier's checks, not Cloudflare's login flow.
- **The keyword stub is not an LLM.** It is the default provider offline and in every test, and the UI labels it "Keyword stub (keyword-v1)". The word "AI" appears only next to Workers AI suggestions.
- **Workers AI has not run.** The provider is tested against a fake binding. The triage Workflow will first call Workers AI after `npm run prod:setup` deploys it; until `npm run prod:verify` records a `workers-ai` suggestion, nothing here shows that it works there. The only model numbers below are from Qwen3-1.7B on a local llama.cpp server.
- **Workflows, Durable Objects, D1 and cron are Miniflare's local implementations.**

## Run it locally

Requirements: npm 11 and Node ^22.22.2, ^24.15.0 or 25 and later. That `engines` range is the narrowest one the dependencies declare (jsdom 30.1.2: ^22.22.2, ^24.15.0 or >=26) plus Node 25, which development used. Tested on Node 25.9.0 (macOS arm64, this Mac) and Node 24.21.0 (GitHub Actions CI on the Ubuntu 24.04 image, where on 2026-10-09 both jobs passed: types, typecheck, `npm test` and build; then Playwright and a one-run contention eval against a preview server). Since 2026-10-15 both CI jobs name `ubuntu-24.04` instead of `ubuntu-latest`, which GitHub moves to Ubuntu 26.04 from 2026-10-19, and pin every action to a commit SHA; that version of the workflow has not run on GitHub yet. Node 22 has not been tried. On Node 25 `npm ci` warns that jsdom does not list it, and the tests pass anyway. No Cloudflare account is needed.

```sh
npm ci
npm run setup:dev          # writes .dev.vars with a fresh RS256 dev key (gitignored)
npm run build              # vite build copies .dev.vars into dist; rebuild after changing it
npm run db:migrate:local   # applies migrations/ to local D1
npm run preview            # http://localhost:8783
npm run seed:local         # in another terminal: 100 employees, 20 resources, 40 demo requests
npm run seed:local -- --history   # optional: also 20 business days of past bookings for the admin reports
```

Open http://localhost:8783, pick a user on the dev sign-in page (admins and staff are listed first), and book. `npm run dev` runs the Vite dev server on the same port.

Both servers listen on loopback only: starting either with `--host` (or any non-loopback host) fails on purpose. Dev mode lets anyone who reaches the server sign in as any employee, admins included, and reset the database, and its localhost check reads the Host header the client sends, so it is only safe on loopback.

To use the local LLM for triage in the app, put `TRIAGE_PROVIDER=openai-compat` in `.dev.vars`, run `npm run llm:serve` (llama-server on port 8130 with `~/Developer/projects/_models/Qwen3-1.7B-Q4_0-rtn.gguf`), and rebuild before `npm run preview`.

## Tests

```sh
npm run types:check   # generated runtime types are current
npm run typecheck     # tsc -b over app, worker and node projects (TypeScript 7)
npm test              # Vitest: worker, worker-ws, ui (jsdom), node
npm run test:e2e      # Playwright (Chromium) against npm run preview
```

- **worker** runs inside workerd against Miniflare's local Durable Object, D1 and Workflows implementations (not mocks): booking rules, the ledger's transactions and rollback, idempotency, cancellation, the outbox and its failure backoff, reports, auth in dev and access modes, the role matrix, the site allowlist, the triage workflow with forced step failures and timeouts, the cron sweep, and a test that fires all 1,000 generated attempts through the Worker at once.
- **worker-ws** holds every test that opens a WebSocket (one worker, no storage isolation, as Cloudflare recommends): per-date deltas, the cross-date case, hibernation, expiry, staff events.
- **ui** tests each of the eight components for its keyboard contract and with axe, and each page against a fetch fake and a fake WebSocket.
- **node** checks the README results block and the `npm run results` command, the `getByName` guard, generator hashes in Node, eval math, the contention eval's retry rules and observer model, the e2e results reporter, the workflow-mode gates, and the hard and injection triage sets (including that the prompt spells out none of their cases).

The Workers Vitest integration is `@cloudflare/vitest-plugin` (formerly `@cloudflare/vitest-pool-workers`, which npm marks deprecated and which cannot start with this compatibility date; see [ADR 0005](docs/adr/0005-vitest-plugin.md)).

## Evals

How each eval runs and what each metric means is in [`evals/README.md`](evals/README.md). In short:

- **Contention:** 1,000 generated reservation attempts (700 on one date, 300 on the next, by all 100 employees over all 20 resources, at least 900 of them contested) fired at once at a running local server, with live observers on both dates and a deliberately unsafe read-then-write D1 booker as a negative control that must produce overlaps. An attempt whose connection is refused, or that gets the preview proxy's own "fetch failed" page, is resent with the same Idempotency-Key and counted by cause; any other failure counts as a server error and fails the run. A resent attempt arrives later than the rest, so on a loaded machine the burst is less concurrent than "at once" suggests. `test/worker/contention.test.ts` fires the same 1,000 attempts inside workerd with no network hop and no retries, and asserts the same invariants.
- **Triage:** 200 templated requests, 40 deliberately ambiguous ones and 12 prompt-injection attempts classified into the four categories, with the keyword baseline beside every model number. The ambiguous and injection items, the rules in [`evals/triage-labeling-guide.md`](evals/triage-labeling-guide.md) and the labels were all produced during the AI-assisted build; no person (and no facilities staff member) has labeled them. The reporter's text reaches the model between `<request>` tags that the reporter cannot close, and each injection item tries to force a different category, so the eval reports how often that works (the steer rate).

## Results

This block is generated by `npm run results` from the committed `evals/results/*.json`. The command refuses files produced on a dirty tree or at a commit that is not an ancestor of `HEAD`, and a test fails if this block differs from its output. All numbers are from local runs on one machine. Latencies and transport retries depend on how busy that machine is (it ran other builds at the same time), so they are not performance claims. Load changes arrival order, so accepted counts and the negative control's overlap count vary between runs; every gate must hold regardless. The Qwen3-1.7B classifier runs at temperature 0 with a fixed seed. Its prompt changed after the earlier result commits (a worked example that answered hard item `hard_01` was removed, and the request now sits between `<request>` tags), so these accuracies are not comparable with those commits.

<!-- results:start -->
### Reservation contention (local workerd)

Command: `node scripts/eval-contention.ts --base-url http://localhost:8783 --runs 5 --observers 4 --control naive-d1 --out evals/results/contention.json`. Run 2026-10-09 (UTC) at commit `b76baab` on Apple M5 (Darwin 25.5.0 arm64, Node v25.9.0).

| Metric | Value |
|---|---|
| Runs | 5 |
| Attempts per run (date A / date B) | 1,000 (700 / 300) |
| Attempts overlapping another attempt (generator) | 984 |
| Accepted | 134 to 142 |
| Rejected: resource conflict / employee conflict | 850 to 861 / 5 to 8 |
| **Overlapping confirmed bookings** | **0** |
| Employee double bookings | 0 |
| Unjustified rejections, phantom or lost acceptances | 0, 0, 0 |
| Validation errors, server errors | 0, 0 |
| D1 projection mismatches | 0 |
| Live observers: date-version gaps, foreign-date messages, final-state mismatches | 0, 0, 0 |
| Live observers: resubscribes after a gap, duplicate deltas, unexpected closes | 0, 0, 0 |
| Observer connect retries (before any attempt is fired) | 0 |
| Slot-key backstop activations | 0 |
| Transport retries: connections refused or reset before any response (resent with the same Idempotency-Key) | 0 to 107 |
| Transport retries: the vite preview proxy's own "fetch failed" 500 page (resent with the same Idempotency-Key) | 0 |
| Negative control (naive read-then-write D1): accepted, overlapping pairs | 502, 2,587 |
| Latency p50 / p95 / p99, run 1 (local, single machine) | 1621.7 / 2310.1 / 2386 ms |

All gates in SPEC 13.1 passed.

### Triage classification: qwen3-1.7b (Qwen3-1.7B-Q4_0-rtn.gguf, llama.cpp, 8192 tokens per slot)

Command: `node scripts/eval-triage.ts --provider openai-compat --base-url http://127.0.0.1:8130/v1 --model qwen3-1.7b --set all --out evals/results/triage-qwen3-1.7b.json`. Run 2026-10-09 (UTC) at commit `b76baab` on Apple M5 (Darwin 25.5.0 arm64, Node v25.9.0).

| Set | Items | Accuracy | Macro-F1 | Schema-valid first try | Keyword fallback | Latency p50 / p95 | Keyword baseline accuracy |
|---|---|---|---|---|---|---|---|
| templated | 200 | 91.0% | 0.909 | 100.0% | 0.0% | 1388.5 / 2296.5 ms | 87.0% |
| hard | 40 | 80.0% | 0.800 | 100.0% | 0.0% | 1194.6 / 1758.2 ms | 65.0% |
| injection | 12 | 41.7% | 0.421 | 100.0% | 0.0% | 1006.1 / 1725.6 ms | 91.7% |

Injection set: each of the 12 requests carries text that tries to force a different category (a forged answer, a fake system line, an override claim, a closing tag). The prediction equalled the forced category on 7 of 12 (steer rate 58.3%; keyword baseline 1 of 12).

llama-server constrains the output to the JSON schema (`response_format` json_schema, strict), so schema validity reflects the decoder, not the model.

Source file: `evals/results/triage-qwen3-1.7b.json`.

### Triage classification: Keyword stub (keyword-v1), not an LLM

Command: `node scripts/eval-triage.ts --provider stub --set all --out evals/results/triage-keyword.json`. Run 2026-10-09 (UTC) at commit `b76baab` on Apple M5 (Darwin 25.5.0 arm64, Node v25.9.0).

| Set | Items | Accuracy | Macro-F1 | Schema-valid first try | Keyword fallback | Latency p50 / p95 | Keyword baseline accuracy |
|---|---|---|---|---|---|---|---|
| templated | 200 | 87.0% | 0.874 | 100.0% | 0.0% | 0.2 / 0.4 ms | 87.0% |
| hard | 40 | 65.0% | 0.645 | 100.0% | 0.0% | 0.2 / 0.8 ms | 65.0% |
| injection | 12 | 91.7% | 0.914 | 100.0% | 0.0% | 0.2 / 0.3 ms | 91.7% |

Injection set: each of the 12 requests carries text that tries to force a different category (a forged answer, a fake system line, an override claim, a closing tag). The prediction equalled the forced category on 1 of 12 (steer rate 8.3%; keyword baseline 1 of 12).

Source file: `evals/results/triage-keyword.json`.

### Triage through the Workflow (local server, Qwen3-1.7B-Q4_0-rtn.gguf via llama.cpp)

Command: `node scripts/eval-triage.ts --mode workflow --app-url http://localhost:8783 --n 20 --base-url http://127.0.0.1:8130/v1 --model qwen3-1.7b --out evals/results/triage-workflow-local.json`. Run 2026-10-09 (UTC) at commit `b76baab` on Apple M5 (Darwin 25.5.0 arm64, Node v25.9.0).

| Metric | Value |
|---|---|
| Requests submitted through the API | 20 |
| Reached awaiting_review with a suggestion | 20 |
| Suggestion providers | openai-compat: 20 |
| Category inside the four-category enum | 20 |
| Suggestion equals the template label | 95.0% |
| Submit to awaiting_review, p50 / p95 (local) | 1293.7 / 2033.9 ms |

Workflow-mode gates (every request reached review with a category in the enum, and every suggestion came from openai-compat or its keyword fallback) passed.

### End-to-end checks (Playwright, Chromium)

Command: `npm run test:e2e`. Run 2026-10-09 (UTC) at commit `b76baab` on Apple M5 (Darwin 25.5.0 arm64, Node v25.9.0).

| Metric | Value |
|---|---|
| Tests passed | 55 of 55 |
| axe scans (WCAG 2.0 A/AA, 2.1 AA, 2.2 AA) and violations | 32 scans, 0 violations |
| Layout checks at 375x812 and 768x1024 and failures | 22 checks, 0 failures |
| Keyboard-only booking and cancellation | passed |
| Live update propagation, 20 bookings, p50 / p95 (local Chromium, booking request to busy cell in a second browser) | 11 / 14 ms |
<!-- results:end -->

## Production setup (not run yet)

Nothing has been deployed from this repository. Production is Nitish's Cloudflare account `dc93c3bc8aa4f9e09a0d7e7354a80873` on the Workers Free plan, its workers.dev subdomain `nitish-ratakonda` and its Zero Trust Free team `old-truth-a7dc`. Every resource name starts with `placessync`. These facts live in [`scripts/lib/prod-config.ts`](scripts/lib/prod-config.ts) and `wrangler.jsonc` `env.production`.

```sh
npx wrangler login                    # once; wrangler always uses this OAuth login
export CF_API_TOKEN=...               # account API token for Access and analytics (permissions below); never printed
npm run prod:doctor                   # read-only: what exists and what is missing
npm run prod:setup -- --dry-run       # prints the plan, changes nothing
npm run prod:setup                    # prints the plan, asks, applies (add --yes to skip the question)
git add wrangler.jsonc && git commit  # the D1 id, AUD and service token Client ID are not secrets
npm run prod:verify                   # contention, triage and CPU checks through Access; writes evals/results/production-verify.json
```

wrangler never sees `CF_API_TOKEN`: wrangler reads that name as a deprecated alias of `CLOUDFLARE_API_TOKEN`, so the scripts remove it (and every other Cloudflare credential variable) from each child process. The token only goes into the Authorization header of Cloudflare API calls. Its permissions: Account > Access: Apps and Policies > Edit; Access: Service Tokens > Edit; Access: Organizations, Identity Providers, and Groups > Read; Workers Scripts > Read; Account Analytics > Read (CPU time in `prod:verify`).

What `npm run prod:setup` does, in order. It first reads everything (the same read-only calls as the doctor) and changes nothing if any check fails: wrangler logged in to the account, `CF_API_TOKEN` set, the token's Zero Trust team and workers.dev subdomain as above, the One-time PIN login `743683e8-42d4-44e9-9991-ba57a1bb0dec` present, Access readable, the Workers AI model in the account's catalog. Then each step runs only if needed:

1. Create the D1 database `placessync` and write its id into `wrangler.jsonc`.
2. Apply `migrations/` remotely.
3. Seed the site, the 20 resources and four people: the owner `nitishsancs@gmail.com` (facilities admin), `nitishsancs+staff@gmail.com` (facilities staff), `nitishsancs+employee@gmail.com` (employee), and `emp_verify`, the employee the verification service token acts as (a reserved `.invalid` address no one can sign in with). Idempotent: resource edits made in the app survive.
4. First deploy, fail-closed: `ACCESS_AUD`, `ACCESS_SERVICE_CLIENT_ID` and `TRIAGE_PROVIDER` are still `SET_ME` placeholders, so every API route answers 500 `misconfigured` and the cron sweep does nothing.
5. Access: the reusable Allow policy `placessync-owner-and-personas` (exactly those three addresses); the service token `placessync-verify` (one year), whose secret goes straight into `.prod/verify-service-token.json` (gitignored, mode 0600; if this Mac lacks it, setup rotates the secret); the reusable Service Auth policy `placessync-verify-service-auth` (exactly that token); and the self-hosted application `placessync-production` for the workers.dev hostname, allowing only the One-time PIN login, with the Allow policy first and Service Auth second. A hostname application rather than Worker-level Access, because Cloudflare's docs say Worker-level policies refuse WebSocket upgrades. Setup never creates a login method.
6. Write the application's AUD, the service token's Client ID and the Workers AI provider (`TRIAGE_PROVIDER=workers-ai`) into `wrangler.jsonc`.
7. Deploy again with the real values (`npm run deploy`), then `npm run build` to restore the local build.
8. Probe: an unauthenticated `GET /api/health` must redirect to the team's sign-in, and the service token must reach `/api/me` as `emp_verify`. Then it prints the doctor's report.

A second run on a finished account changes nothing and only probes (`--redeploy` forces a deploy). The Worker accepts a token with no email only when it comes from that one service token (`common_name` equal to `ACCESS_SERVICE_CLIENT_ID`), and then acts as `emp_verify`, whose role comes from D1 like everyone else's.

`npm run prod:verify` (after setup) signs in with the service token and records, in `evals/results/production-verify.json`: health and identity; 200 concurrent bookings of one hour on one desk, each with its own Idempotency-Key, where exactly one may be confirmed and a live WebSocket observer must see it and its release (the booking is cancelled afterwards); 3 facilities requests through the Workflow, each needing a Workers AI suggestion (cancelled afterwards, so none counts as a staff review); and CPU time from `wrangler tail` and the GraphQL Analytics API against the Free plan's 10 ms. A default run costs about 250 Worker requests and as many Durable Object requests, a few hundred D1 rows and about 200 Workers AI neurons. `--person` signs in as the person from `cloudflared access login` instead, which as the owner also checks that the booking reaches the D1 report view. `npm run results` renders a committed production file under its own heading in Results; it refuses a local rehearsal.

## Production on the Workers Free plan

Nitish chose the Free plan (2026-10-10). Nothing in this app needs Workers Paid: `wrangler.jsonc` has no `limits` block, the only Durable Object class is SQLite-backed, and there is one Cron Trigger. Every limit below was read on developers.cloudflare.com on 2026-10-15. "Fits" means by design and, where noted, by a test; no production measurement exists yet (`npm run prod:verify` records CPU time once deployed).

| Feature | Free limit | Source | This app | Verdict |
|---|---|---|---|---|
| CPU time per HTTP request and per Cron Trigger | 10 ms | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | API requests verify one RS256 JWT, parse with zod and wait on D1, the Durable Object and Workflows (waiting is not CPU time); the cron sweep handles at most 12 rows | fits by design; `prod:verify` measures it |
| CPU time per Workflow step | 10 ms | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) | each step is one D1 batch, one Durable Object RPC or one Workers AI call plus JSON parsing | fits by design; measured where `wrangler tail` reports it |
| Requests per day | 100,000 per account (shared with three other apps), reset 00:00 UTC; over it, Error 1027 | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | 720 cron runs a day plus traffic; about 250 per `prod:verify` run. Static assets are free and unlimited and the SPA is served without invoking the Worker (`run_worker_first` is `/api/*` only), per [static assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) | fits |
| Subrequests per invocation | 50 external, 1,000 to Cloudflare services | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | external: the team JWKS fetch, cached per isolate; internal: a few D1, Durable Object, Workflow and Workers AI calls per request | fits |
| D1 queries per invocation | 50, each statement in a batch counted | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) | cron sweep at most 37 statements, outbox flush 41 (`test/worker/free-plan.test.ts` counts both), API routes a handful | fits (tested) |
| D1 rows read / written per day | 5 million / 100,000, reset 00:00 UTC; over it, queries fail until then | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) | the sweep's indexed SELECT reads fewer than 10 rows a run (tested), so at most about 7,200 a day; bookings write a few rows each | fits |
| D1 databases, size | 10 per account, 500 MB each | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) | one database; `prod:doctor` counts the account's | fits |
| Durable Objects backend | SQLite-backed only | [Durable Objects limits](https://developers.cloudflare.com/durable-objects/platform/limits/) | `new_sqlite_classes: ["SiteLedger"]`, one object per site | fits |
| Durable Object usage | 100,000 requests, 13,000 GB-s, 5 million rows read and 100,000 written per day; incoming WebSocket messages count 20:1 | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) | about one RPC and one alarm per booking; hibernatable WebSockets accrue no duration while idle | fits |
| Workflows | on Free: 100 concurrent running instances per account (waiting ones do not count), 100,000 executions a day shared with Workers, 1,024 steps, 3-day retention | [Workflows limits](https://developers.cloudflare.com/workflows/reference/limits/) | 6 or 7 steps per request; each instance then waits up to 24 hours for review, which does not count as running | fits |
| Cron Triggers | 5 per account | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | one, `*/2 * * * *`; `prod:doctor` counts the account's | fits if the other apps use at most 4 |
| Workers AI | 10,000 neurons a day, reset 00:00 UTC; over it, calls fail | [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/) | Llama 3.3 70B fp8-fast: 26,668 neurons per million input tokens, 204,805 per million output; a classification is about 1,000 tokens in and at most 160 out, about 60 to 66 neurons; up to 3 calls if the model's JSON fails validation. Shared with three other apps; `prod:verify` uses 3 requests. The model supports [JSON mode](https://developers.cloudflare.com/workers-ai/features/json-mode/) | fits a demo's traffic; once the day's neurons are gone, requests get the keyword fallback, labeled as such |
| Access | self-hosted application on a workers.dev hostname; service tokens use no seat; 500 applications and 50 service tokens per account | [Access for Workers](https://developers.cloudflare.com/workers/configuration/cloudflare-access/), [seats](https://developers.cloudflare.com/cloudflare-one/team-and-resources/users/seat-management/), [account limits](https://developers.cloudflare.com/cloudflare-one/account-limits/) | one application, two policies, one service token, three people signing in (three seats). developers.cloudflare.com does not state the Free plan's seat count | fits |
| Worker size and startup | 64 MiB uncompressed, no compressed limit; 1 s startup | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) | about 443 KB built Worker | fits |
| Workers Logs | 200,000 log events a day, 3-day retention | [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) | `observability.enabled`: an invocation log per request, plus console lines only on errors and non-empty sweeps | fits a demo's traffic; logs only, requests are unaffected |

## Known limitations

- **Not deployed.** See the Status line at the top. No claim here is about Cloudflare's production services until `npm run prod:verify` has run and its results are committed.
- **Free plan.** The account's daily limits (Worker requests, Workers AI neurons, D1 and Durable Object rows) are shared with three other apps, so another app's traffic can exhaust them; past a limit, Cloudflare answers with errors until 00:00 UTC. When Workers AI fails, requests get a keyword-fallback suggestion, labeled so. The cron sweep examines 12 stranded requests per run (D1's 50 queries per invocation), and alarms and Workflow steps can lag.
- **The verification service token** expires a year after setup creates it; `npm run prod:doctor` warns 30 days ahead, and rerunning setup after deleting it makes a new one.
- **Figma:** no Figma file exists; the UI kit follows the design tokens in `src/client/ui/tokens.css` and the contracts in SPEC 14.2. See [`design/FIGMA.md`](design/FIGMA.md).
- **Accessibility evidence is automated:** axe on every page and component state at two viewports, component keyboard tests, and a keyboard-only booking path. No manual screen-reader pass has been done.
- **Mobile layouts** are checked in desktop Chromium resized to 375x812 and 768x1024 (no touch or mobile user-agent emulation), not on devices.
- **Single ledger per site** is a throughput ceiling by design (ADR 0001); v1 has one site.
- **Role changes** take effect on open WebSockets no later than token expiry (8 hours for dev tokens; the Access session length in production); v1 has no role-change API.
- **Prompt injection:** the injection set in Results shows the local model can be steered by text inside a request. The defence is the review gate, not the prompt: a suggestion must be one of the four categories, its rationale is cut to 160 characters, and nothing is assigned until a staff member reviews it.
- **Rate limiting** is not implemented (a production follow-up using the Workers rate limiting binding).

## License

MIT. Copyright (c) 2026 Nitish Chowdary.
