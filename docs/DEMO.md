# PlacesSync live demo

A script for showing the deployed app in an interview: a short walkthrough in two browser windows, then technical talking points and answers to likely questions. Every button, label and route below exists in the code at this commit. Every measured number names the committed file in [`evals/results/`](../evals/results) it comes from. Plan limits and code settings name the file or README section where they are written down.

Note (2026-10-15, later the same day): a usability round changed the local code after this script was written, and production has not been redeployed, so the walkthrough below still describes the deployed app. Locally, one click on a desk selects an hour (the staged click and Shift+click still give 10:00 to 11:00), the grid legend also lists "Past or closed", a lost race offers "Pick another time" beside "Cancel", "Resolve" asks for an optional note first, and the Staff queue refreshes itself every 60 seconds. A visual pass on 2026-10-16, also local only, adds tiles above the Staff tabs, a day timeline in place of the "Today's bookings" table, a progress tracker on the request page, free counts under the times on Find a space, and charts on both Admin report tabs. In the local build the "Suggestion agreement by provider" table that step 6 reads is unchanged and comes first on the Requests tab, and the optional step's "Bookings per day" table is behind "Show table" under a chart of the same numbers. [`USER-WORKFLOWS.md`](USER-WORKFLOWS.md) lists every change.

Live URL: https://placessync-production.nitish-ratakonda.workers.dev (Cloudflare Workers Free plan, behind Cloudflare Access, team `old-truth-a7dc`, One-time PIN as the only login).

The headline is the race: two people book the same desk for the same hour at the same moment, exactly one wins, the other gets a conflict, and both screens update live.

## What production has shown, and what it has not

Shown, in [`evals/results/production-verify.json`](../evals/results/production-verify.json) (`npm run prod:verify`, 2026-10-15, at `34f9fe2`, signed in through Access with the verification service token as `emp_verify`):

- 200 concurrent attempts to book one desk for the same hour, each with its own Idempotency-Key, all 200 by the one service-token identity `emp_verify`: 1 confirmed, 199 `resource_conflict`, 0 employee conflicts, 0 server errors, 0 transport errors, and 1 confirmed booking in that hour afterwards. The ledger checks the desk before the employee, so the 199 were recorded as desk conflicts; with one identity, the employee rule would have refused them too. The evidence for many employees at once is local: 100 employees over 20 resources, 5 runs, 0 overlapping confirmed bookings ([`contention.json`](../evals/results/contention.json), local workerd).
- A live WebSocket observer saw that check's own booking (2026-10-19, 07:00 to 08:00) and its release: 2 deltas, 0 gaps and 0 duplicates.
- 3 of 3 facilities requests went through the Workflow and got a suggestion from Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`), each on the first attempt, each in the four-category enum.
- The CPU gate failed. Over the 218 requests in the analytics range around the burst, CPU p50 was 15.72 ms and p99 40.97 ms, above the Free plan's nominal 10 ms; all 218 ended with status `success`. So the file's overall `passed` is `false`. Say this if CPU or the Free plan comes up.

Not shown in production, so do not claim it:

- A person's One-time PIN sign-in. `prod:verify` used the service token, so no results file covers the two-persona flow below. Rehearse it the day before.
- A contended burst across several people. Every production attempt came from `emp_verify`.
- The booking reaching the D1 report view (`projection.checked` is `false`; it needs an admin sign-in).
- The Cron Trigger firing, CPU per Workflow step, and every failure path: the Workflow's retry, keyword fallback and review timeout, the outbox's backoff when D1 fails, and Durable Object eviction. There is no fault injection in production. Those paths have run only in local tests on Miniflare, so call them local when you mention them.
- Any Workers AI accuracy. Three requests written for the check are a sanity check, not a measurement.

## Cast

| Window | Sign in as | Role in the production seed | Header shows | Navigation |
|---|---|---|---|---|
| A: a normal browser window | `nitishsancs+employee@gmail.com` | `employee` (`emp_employee`) | Employee (persona) · Employee | Find a space, My bookings, Report issue, My requests |
| B: a private window, or a second browser | `nitishsancs@gmail.com` | `facilities_admin` (`emp_admin`) | Nitish Chowdary · Facilities admin | the same four, plus Staff and Admin |

The third address, `nitishsancs+staff@gmail.com` (`facilities_staff`, shown as "Facilities Staff (persona) · Facilities staff"), sees Staff but not Admin. Use it for window B if you want to show that difference, and skip the Admin step. All three are `PERSONAS` in [`scripts/lib/prod-config.ts`](../scripts/lib/prod-config.ts): `npm run prod:setup` seeded them into D1 and put exactly those addresses in the Access Allow policy. Every code arrives in the `nitishsancs@gmail.com` inbox.

Two people at once need two Access sessions. A private window keeps its own cookies, so it holds a second sign-in. Production has no Sign out button (the header shows one only in local dev mode); to change persona, close the private window and open a new one.

The interviewer cannot sign in, because the Allow policy names only those three addresses. Share your screen instead.

## Before the interview

The day before: run the whole 4-minute version once, end to end, then clean up (see [After the demo](#after-the-demo)). This is the only rehearsal of the One-time PIN path, since no results file records one.

30 minutes before, and before you share your screen:

1. Window A: open the URL. Access sends you to the team's sign-in page on `old-truth-a7dc.cloudflareaccess.com`. Enter `nitishsancs+employee@gmail.com`, then the 6-digit code from the inbox. Signing in now keeps the inbox off the shared screen. The Access session lasts 8 hours (`sessionDuration` in `scripts/lib/prod-config.ts`).
2. Window B (private): the same, with `nitishsancs@gmail.com`.
3. Check that both headers match the table above.
4. In both windows open Find a space. Next to the heading the status should read "Live updates on".
5. In both windows pick the same date in the month calendar (its heading on screen is the month and year; "Booking date" is only its accessible name): a weekday in the next few days, not today. On today, slots that have started cannot be picked; weekends and dates more than 14 days ahead are disabled. Then click the "Desks" tab and check that the line above the grid reads "<n> spaces on <that date>." in both windows. Desk 2A-01 is the first row.
6. Check that Desk 2A-01 is free from 10:00 to 11:00, and that neither persona has an upcoming desk booking at that hour (My bookings, Upcoming). Times are the site's local time, America/Los_Angeles.
7. Keep each window at least 640 px wide. Narrower than that, the slot grid becomes a list of time buttons for one space at a time (`COMPACT_QUERY` in `src/client/hooks/useMediaQuery.ts`). Below 1024 px wide, as two windows side by side on a laptop usually are, the calendar and filters stack above the grid (`.layout` in `src/client/pages/pages.module.css`); scroll both windows so the Desk 2A-01 row and the 10:00 column are in view before you share the screen.
8. Window B: Staff, "Triage queue" tab. It should read "Nothing waiting for review.", so the demo request will be the only row.
9. Have the fallback ready: the local server built and running, and the README open at Results (see [If something misbehaves](#if-something-misbehaves)).

## The 60-second version

Staged beforehand in both windows: Find a space, the same date, the "Desks" tab. In the Desk 2A-01 row, click the cell under 10:00, then Shift+click the next cell, so the button reads "Book Desk 2A-01, 10:00 to 11:00". Click it. Both windows now show the dialog "Book Desk 2A-01" with a "Confirm booking" button.

1. **0:00.** Say: "Two people, two separate Cloudflare Access sessions, the same desk for the same hour. Both have the confirm dialog open."
2. **0:10.** Click "Confirm booking" in window A, then straight away in window B. Window A: the dialog closes and the hour shows as Yours. Window B: the dialog says "Someone else booked this first: 10:00 to 11:00 is taken. The grid has been refreshed; pick another time." The dialog covers the grid, so click "Cancel" in B's dialog; B's grid now shows the hour as Booked. If B won instead, say the same with the windows swapped.
3. **0:20.** Say: "Every booking for this site goes through one Durable Object, the SiteLedger. It runs the overlap check and the insert in one SQLite transaction with nothing awaited in between, and it also claims each 15-minute slot under a primary key as a backstop. So exactly one request wins. After the commit it pushes the change to every browser watching that date over hibernatable WebSockets."
4. **0:40.** Say: "Two clicks a moment apart are a small race, so the production check fired 200 concurrent attempts from one test identity at one desk for one hour: 1 confirmed, 199 conflicts, 0 server errors, and a live observer saw that booking and its release. The same app sends each facilities request through a Workflow to Workers AI for a suggested category, which staff accept or change; 3 of 3 check requests got a Workers AI suggestion. I can show that next."

## The 4-minute version

Start from the "Before the interview" state, with no dialog open.

### 1. Set the scene (0:00 to 0:15)

Do: point at the two headers.

Say: "PlacesSync is a workplace app: book desks and rooms, report facilities issues, and follow each one until it is resolved. It runs on the Workers Free plan behind Cloudflare Access. On the left is an employee; on the right is the facilities admin, in a private window so it is a separate Access session."

### 2. The race (0:15 to 1:30)

Do, in both windows: in the Desk 2A-01 row, click the cell under 10:00, Shift+click the next cell, then click "Book Desk 2A-01, 10:00 to 11:00". The dialog "Book Desk 2A-01" lists the space, date and time, and says "Desks book for 60 to 600 minutes." (With only one 30-minute cell selected, it shows "A desk booking lasts 60 to 600 minutes." and "Confirm booking" stays disabled.)

Say: "The browser checks the booking rules inline with the same pure function the ledger runs, but it never decides availability. Each attempt carries its own Idempotency-Key."

Do: click "Confirm booking" in window A, then in window B.

What happens: A's dialog closes and the hour shows as Yours (the grid legend reads Booked, Yours, Selected). B's dialog shows "Someone else booked this first: 10:00 to 11:00 is taken. The grid has been refreshed; pick another time." Whichever request reaches the SiteLedger first wins; with A clicked first, that is normally A. If B won, swap the roles: say the same thing with the windows swapped, and in step 3 cancel from window B's My bookings while window A watches.

Say: "B's dialog stays open on purpose. It captured the booking when it opened, so a live update cannot change the request under the user, and the server's 409 is the answer."

Do: click "Cancel" in B's dialog. The dialog is modal and dims the page behind it, so close it before pointing at B's grid.

Say: "B's grid shows the hour as booked. The ledger pushed a delta over the WebSocket, and the 409 also refreshed the grid, so this screen alone cannot show which got there first. The release in a moment is the clean proof of the push, because B sends no request there. Inside the ledger, one synchronous transaction does the idempotency lookup, the rules, an overlap query on the desk, an overlap query on the employee, the insert, a slot row per 15 minutes for the desk and for the employee under primary keys, the version bumps, an outbox row for reporting, and the stored response. If any slot is already claimed, the whole transaction rolls back. In production, 200 concurrent attempts from one test identity on one desk gave 1 confirmed and 199 conflicts with 0 server errors."

### 3. The release (1:30 to 1:50)

Do: window A, My bookings, "Upcoming" tab. On the Desk 2A-01 row click "Cancel booking". In the dialog "Cancel this booking?" click "Cancel booking" (the other button is "Keep booking").

What happens: window B is still on Find a space for that date, and the hour turns free again without a reload. B sent no request, so the change can only have come over the WebSocket.

Say: "Cancelling is the same path in reverse: one transaction deletes the slot claims and marks the booking cancelled, and a released delta goes out. Window B made no request; the push alone updated it. In production a live observer saw the same kind of pair for the check's own booking: the booking and its release, 2 deltas, no gaps."

### 4. A facilities request (1:50 to 2:50)

Do: window B, Staff, "Triage queue" tab ("Nothing waiting for review.").

Do: window A, Report issue. Fill in:

- Title: `Wall display in Sequoia shows no signal`
- Description: `The wall display in Sequoia stays on a no signal screen when we plug in a laptop. It started this morning.`
- Space (optional): type `Sequoia` and pick it.

Click "Submit request". Window A moves to the request page with "Your request was submitted. It is being categorized automatically, then facilities staff will review it." and Suggested category "Classification pending".

Submit one request only. Each classification spends Workers AI neurons from the Free plan's 10,000 a day, which this account shares with three other apps (README, Production on the Workers Free plan; neuron use has never been read from the account).

Say: "The request is committed to D1 first. Then a Workflow instance starts with the request id as its instance id, so a retry cannot start a second one. Its steps load the request, ask Workers AI in JSON mode for one of four categories, record the suggestion, and notify staff over the ledger's WebSocket channel. Then it waits up to 24 hours for a review."

Do: watch window B. When the staff event arrives, the Staff page reloads its queue: the new row shows the suggested category, a confidence percentage and a "Workers AI" label. In `prod:verify` each of the 3 suggestions was recorded at most 5,449 to 7,782 ms after submitting (the file records upper bounds, `production-verify.json`). No production results file covers the staff event itself, so if the row has not appeared after about 15 seconds, reload the page.

The category should be "Electrical and AV", whose scope covers displays (`CATEGORY_SCOPE` in `src/shared/triage/categories.ts`). If the model picks another, use "Reassign" in the next step and say that is what the review is for.

### 5. Staff review (2:50 to 3:30)

Do: window B, click "Accept" on the row. The dialog "Accept the suggestion?" shows the request and "Suggested: Electrical and AV (Workers AI)." followed by the model's one-sentence note. Click "Accept". The row moves to the "In progress" tab with status Assigned, where "Start work" and "Resolve" move it on.

Say: "The model only suggests. Staff accept it, or use Reassign to pick another category. The decision is a conditional UPDATE in D1, so two staff reviewing at once produce exactly one review, and the API sends the waiting Workflow an event so it records the outcome."

Do: window A, reload the request page. Status reads Assigned, Final category reads Electrical and AV, and the Timeline lists "Submitted", "Suggested category: Electrical and AV (Workers AI)" and "Reviewed by staff: suggestion accepted".

### 6. The admin view (3:30 to 4:00)

Do: window B, Admin, "Requests" tab. The table "Suggestion agreement by provider" has a "Workers AI agreement" row: how many suggestions staff reviewed in the date range (the dry run's too) and how many they kept.

Say: "Agreement is reported per provider and never mixed. A keyword fallback or the local model gets its own row, and manual categorizations are left out because no suggestion was shown."

Optional, only if the dry run showed it: the "Utilization" tab, table "Bookings per day", counts the race booking under Cancelled for its date. Bookings reach D1 through an outbox: the ledger writes a fact row in the same transaction as the booking, and its alarm copies it to D1 with upserts guarded by version. Production has not checked this view (`projection.checked` is `false`), and the README notes that production alarms can lag by up to a minute. If it did not show in the dry run, skip the tab and explain the outbox in words.

Close: "That's the app. I'm happy to go deeper into any part of it."

## Technical talking points

For a People team audience, the framing is trust in an internal tool: nobody loses a desk they were told they had, every screen shows the same truth, and a model never routes a request without a person.

- **One writer per site.** The `SiteLedger` Durable Object is the only writer of reservations for its site, and its SQLite is the source of truth. A booking is one `transactionSync` with no `await` inside (`src/worker/ledger/site-ledger.ts`). Slot rows under primary keys are a second line of defence if the overlap query were ever wrong ([ADR 0002](adr/0002-slot-claims-under-a-primary-key.md)).
- **Live updates.** Browsers subscribe per date over hibernatable WebSockets. Each commit bumps that date's version in the same transaction; a client applies a delta only when its version is the last one plus 1, ignores duplicates, and resubscribes that date for a fresh snapshot on a gap ([ADR 0007](adr/0007-per-date-live-versions.md)). The object registers a ping/pong auto-response, so a client keepalive would not wake it; the browser client sends none and reconnects with backoff if a socket drops.
- **Reporting.** D1 is a projection. Each commit writes an outbox row in the same transaction, and the object's alarm flushes it to D1 with version-guarded upserts, so a crash between commit and send loses nothing ([ADR 0003](adr/0003-transactional-outbox.md)).
- **Triage.** One Workflow instance per request, with retries and a timeout on the model call, a labelled keyword fallback, an idempotent record step, a staff notification and a 24-hour wait for review ([ADR 0006](adr/0006-workflow-for-triage.md)). A cron sweep every 2 minutes creates, restarts or hands off the Workflow for requests stranded in `submitted` ([ADR 0008](adr/0008-triage-sweep.md)); no results file shows it firing in production yet.
- **Sign-in.** Access runs in front of the hostname. The Worker still verifies the `Cf-Access-Jwt-Assertion` token itself, and roles come only from D1 ([ADR 0004](adr/0004-explicit-access-jwt-verification.md)).
- **Evidence.** Local and production numbers are kept apart. The README Results block is generated from the committed result files, and a test fails if anyone edits it by hand.

## Likely questions

### Why one Durable Object per site?

Because the rules span resources. An employee may hold one desk and one room at a time, so a per-desk object could not check that in one transaction ([ADR 0001](adr/0001-one-ledger-per-site.md)). One object per site serializes every write for that site: `transactionSync` runs synchronously with nothing awaited inside, so no other request in that object can run between the overlap check and the insert. The same object holds the WebSockets and bumps the per-date version inside the booking's transaction, so deltas go out in commit order. The cost is a throughput ceiling per site, listed in the README's Known limitations; more sites would shard by site id. The Worker never takes an object name from a request: `ledgerFor` (`src/worker/ledger/ledger-for.ts`) only accepts the configured site, and `test/node/ledger-for-guard.test.ts` fails if `getByName` appears anywhere else.

### What does the Idempotency-Key do?

It makes a resent booking safe. The browser creates a new key for each attempt (`web-` plus a UUID, `src/client/api/client.ts`) and reuses it only to resend the same body after getting no definitive answer; after a 409 or 422, or with a changed body, it makes a new one (`src/client/pages/BookingDialog.tsx`). The API requires 8 to 64 characters. Inside the booking's transaction the ledger stores the key (scoped to the employee), a SHA-256 of the request and the full response, 409s included. A resend with the same key and body gets the stored response back, so a timeout after the commit cannot become a second booking; the same key with a different body gets 422 `idempotency_key_reuse`. The alarm deletes keys older than 24 hours. In the local contention eval, run 1 resent 107 attempts after connection errors, with their original keys, and still had 0 phantom or lost acceptances ([`contention.json`](../evals/results/contention.json), local). In production each of the 200 attempts had its own key, so the 199 conflicts are 199 different requests, not replays.

### How does the naive D1 version double-book?

It reads, then writes, with nothing holding the two together. `POST /api/dev/naive/reserve` (`src/worker/routes/dev.ts`) runs a `SELECT` for overlapping rows in D1 and, if there are none, an `INSERT`, as two separate statements with no transaction spanning both. Under concurrency, many requests read "no overlap" before any of them has written, and all of them insert. Against the same 1,000 generated attempts it accepted 502 with 2,587 overlapping pairs, while the ledger had 0 overlapping confirmed bookings in all 5 runs ([`contention.json`](../evals/results/contention.json), local workerd on one Mac). It exists only as the eval's negative control: the eval fails unless the control produces overlaps, which proves the overlap detector can see a double booking. It is a dev-only route; production answers 404.

### What happens when the Durable Object restarts?

Nothing half-done survives, and nothing committed is lost. A booking's check, insert, slot claims, version bumps, outbox row and idempotency record are one transaction, so a restart cannot leave half a booking. What lives only in memory (the pending-alarm flag and the catalog load) can be rebuilt. The constructor runs under `blockConcurrencyWhile`: it applies the schema and, if outbox rows are still unflushed, arms the alarm so D1 catches up. While idle, the object can hibernate without dropping its sockets, and each socket's attachment (employee, role, token expiry, subscribed dates) survives. If a socket does drop, the page shows "Live updates offline, retrying", reconnects with jittered backoff between 0.5 s and 15 s (`src/client/live/socket.ts`), resubscribes each date and gets a fresh snapshot. A user whose booking got no answer presses "Confirm booking" again, which resends the same key, and the ledger replays its stored answer.

The evidence is local only: `test/ws/live.test.ts` ("survives hibernation: the attachment persists and the next booking reaches the socket") and `test/worker/projection.test.ts` ("re-arms the alarm in the constructor after eviction when the outbox is non-empty", "backs off with its own failure counter while D1 fails, keeps rows, then drains") run on Miniflare. Nobody has restarted the production object on purpose.

### Was that really simultaneous?

Not in the browser: two clicks are a moment apart. The browser demo shows the user experience. The concurrency evidence is the production check, 200 concurrent attempts on one desk for one hour, all 200 by the one service-token identity `emp_verify`, with 1 confirmed and 199 conflicts (`production-verify.json`). That shows the ledger serializing one desk; it is not 200 people. Production has not run a burst across several people. The evidence for many employees is local: 5 runs of 1,000 generated attempts by 100 employees over 20 resources, with 0 overlapping confirmed bookings and 0 employee double bookings (`contention.json`, local workerd). The production check is pass or fail, not a load test.

### How do the screens stay in sync without missing an update?

Per-date versions. A snapshot carries the date's version; each delta must be exactly the next one. A duplicate is ignored, and a jump makes the client resubscribe that date alone for a fresh snapshot, so a booking on another date never looks like a gap. The production observer saw 0 gaps and 0 duplicates over its 2 deltas, the check's own booking and release (`production-verify.json`). Locally, 4 observers per run saw 0 date-version gaps and 0 final-state mismatches across 5 runs (`contention.json`), and in Playwright, from the booking request to the busy cell in a second browser took p50 11 ms and p95 13.6 ms over 20 bookings ([`e2e.json`](../evals/results/e2e.json), local Chromium; the README rounds the p95 to 14).

### Does it fit the Workers Free plan?

Mostly, with one measured exception. The CPU gate failed: in the analytics range around the 200-attempt burst, 218 requests had CPU p50 15.72 ms and p99 40.97 ms against the nominal 10 ms, and all 218 ended with status `success`, so none was stopped (`production-verify.json`). That is not a fit, and heavier load could be throttled; whether to cut per-request CPU is an open item in PROGRESS. CPU per Workflow step is unknown, because it was not measured. The README's Free plan table marks the other limits as fitting by design, some also by a test or by the deployment; no daily usage total (requests, rows, neurons) has been read from the account.

### How good is the AI, and can a request steer it?

No Workers AI accuracy is claimed. Production shows Workers AI answering through the Workflow for 3 requests written for the check (`production-verify.json`). The accuracy numbers are local, from Qwen3-1.7B on llama.cpp: 91.0% on 200 templated requests and 80.0% on 40 ambiguous ones ([`triage-qwen3-1.7b.json`](../evals/results/triage-qwen3-1.7b.json)), against the keyword baseline's 87.0% and 65.0% ([`triage-keyword.json`](../evals/results/triage-keyword.json)). The ambiguous and injection items and their labels were written during the AI-assisted build, not by a person. On 12 prompt-injection requests the local model was steered to the forced category 7 times. So the defence is the review, not the prompt: the suggestion must be one of four categories, its note is cut to 160 characters (`RATIONALE_MAX` in `src/shared/triage/schema.ts`), the reporter's text sits between `<request>` tags it cannot close, and nothing is assigned until staff review it.

### Why a Workflow for triage?

The model call can be slow, fail or return bad JSON, and the review can take a day. A Workflow gives durable steps: the classify step retries with backoff under a 60-second timeout, then falls back to the keyword classifier, labelled "Keyword fallback"; step results are cached, so a D1 failure afterwards does not call the model again; and `waitForEvent` holds the review for up to 24 hours, then flags it overdue. The instance id is the request id, so starting twice is harmless. In production the classify-to-review path ran for 3 requests; the retry, fallback and timeout paths have run only in local tests (`test/worker/triage.workflow.test.ts`).

### How is sign-in checked?

Access stands in front of the workers.dev hostname with One-time PIN as the only login and an Allow policy of three addresses. It is a hostname application rather than Worker-level Access because, per Cloudflare's docs cited in the README, Worker-level policies refuse WebSocket upgrades. The Worker verifies the `Cf-Access-Jwt-Assertion` token itself with `jose`: RS256 only, issuer equal to the team domain, audience equal to the application's AUD, keys from the team's certs endpoint. It looks the email up in D1 for the role; an unknown address gets 403. One service token, used only by `prod:verify`, maps to the employee `emp_verify`.

## If something misbehaves

### Access sign-in fails, or no code arrives

Switch to the local build, which runs the same code on workerd with Miniflare's local Durable Object, D1 and Workflows. Prepare it before the interview (README, Run it locally) and leave it running:

```sh
npm run setup:dev          # only if .dev.vars is missing
npm run build
npm run db:migrate:local
npm run preview            # http://localhost:8783
npm run seed:local         # in a second terminal
```

Open http://localhost:8783 in a normal window and a private window. The page "Sign in (local development)" has "Quick picks" buttons by role (for example "Employee: ..." and "Facilities admin: ..."). Then run the same steps. Say out loud what differs: sign-in is simulated by a token signed with a key generated on this machine, and triage uses the keyword stub, labelled "Keyword stub (keyword-v1)", which is not an LLM. The local data also differs: `npm run seed:local` inserts 40 demo requests with keyword stub suggestions (`seedRequests` in `src/worker/seed.ts`), some still awaiting review. So the Staff "Triage queue" will not read "Nothing waiting for review."; the seeded rows are labelled Keyword stub, and the new request is the last row, since the queue is oldest first. On Admin, the agreement row will read "Keyword stub (keyword-v1) agreement". Stop the preview server with Ctrl+C afterwards.

Then show the committed local contention numbers, in the README Results block or [`contention.json`](../evals/results/contention.json) (local workerd on one Mac, 2026-10-09, at `b76baab`):

| Metric | Value |
|---|---|
| Runs, attempts per run | 5, 1,000 (700 on one date, 300 on the next), by 100 employees over 20 resources |
| Attempts overlapping another attempt | 984 |
| Accepted per run | 134 to 142 |
| Rejected: resource conflict / employee conflict | 850 to 861 / 5 to 8 |
| Overlapping confirmed bookings, employee double bookings, server errors | 0, 0, 0 in every run |
| D1 projection mismatches, live observer date-version gaps | 0, 0 in every run |
| Negative control (naive read-then-write on D1): accepted, overlapping pairs | 502, 2,587 |

To run it live, use the CI form against the local preview: `npm run eval:contention -- --runs 1 --observers 2 --out evals/results/ci-contention.json`. That output path is gitignored. The eval resets the local data first, so run it after the local walkthrough, and its accepted count varies with arrival order, so quote the committed file, not this run. With no server at all, `npx vitest run --project worker test/worker/contention.test.ts` fires the same 1,000 attempts through the Worker inside workerd and asserts the same invariants (pass or fail, no numbers).

### Workers AI is slow, out of neurons, or failing

- **The row shows "Keyword fallback" instead of "Workers AI".** That is the designed failure path: after the classify step's retries, the Workflow records the keyword classifier's answer under its own label, and the review works the same way. Say so, and say it has been tested locally ("falls back to the keyword classifier when classify exhausts its retries" in `test/worker/triage.workflow.test.ts`), not seen in production.
- **The model hangs.** The classify step allows three attempts of up to 60 seconds each, with 2 and 4 second waits between them (`src/worker/triage/triage-workflow.ts`), so the keyword fallback can take about 3 minutes, longer than the triage segment. Do not wait: move to the Admin step or the local numbers, and come back to the Staff page afterwards.
- **No row appears.** The queue lists a request still in `submitted` once it is 2 minutes old (`listStaffQueue` in `src/worker/repo/requests.ts`), as "Classification pending" with a "Categorize" button. The Staff page reloads its queue only when it opens, after an action, or on a staff event, so after 2 minutes reload the page yourself. Click "Categorize", choose a Category in the dialog "Categorize the request", and click "Save category". Do not wait for the cron sweep; no results file shows it firing in production.
- For the numbers, use the production triage line (3 of 3 via Workers AI, `production-verify.json`) and the local Workflow run: 20 of 20 requests reached review with a suggestion from the local Qwen3-1.7B, submit to review p50 1,293.7 ms ([`triage-workflow-local.json`](../evals/results/triage-workflow-local.json), local).

### Live updates show "Live updates offline, retrying"

Reload the page. The client reconnects on its own with backoff, and the grid also refreshes after any conflict. For the evidence, use the production observer line in `production-verify.json`.

### A window says "You already have a desk booked at that time"

That persona already holds another desk overlapping that hour. The ledger checks the desk first and the employee second, so this message means the desk was still free when this request ran, but this persona already holds a desk at that hour, and the employee rule refused it. The other window's request can then take the desk. Cancel the old booking in My bookings, or pick another hour. It is a fair moment to explain the employee rule, which is why the ledger is per site rather than per desk.

## After the demo

- The race booking was cancelled in step 3. If you skipped that step, cancel it under My bookings in the window that won.
- Window B: Staff, "In progress" tab, "Resolve" the demo request so the In progress tab stays clear (the Triage queue is already empty once it is accepted), and any left over from the dry run. Resolved requests still count in the Admin reports.
- Close the private window.
- Do not run `npm run prod:verify` as a warm-up. It books, cancels and submits requests in production, spends Workers AI neurons and needs `CF_API_TOKEN` (README, Production setup).
