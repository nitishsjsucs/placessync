// Production verification, run after `npm run prod:setup` against the deployed Worker,
// through Cloudflare Access. By default it signs in with the verification service token
// (Service Auth policy; credentials from .prod/verify-service-token.json, written by setup,
// or PLACESSYNC_VERIFY_CLIENT_ID and PLACESSYNC_VERIFY_CLIENT_SECRET) and acts as the
// employee emp_verify. Nothing secret is printed or written to the results file.
//
//   1. GET /api/health and /api/me: Access mode, Workers AI ready, catalog seeded, and the
//      identity the run acts as.
//   2. A small contention check: --attempts (default 200) concurrent bookings of the same
//      hour on one desk (--desks 2 alternates two desks), each with its own
//      Idempotency-Key. Exactly one may be confirmed, every other attempt must be a
//      conflict, no server error, no dropped response; a live WebSocket observer must see
//      the booking and, after cleanup, its release, with no gap. For an admin sign-in
//      (--person as the owner) the booking must also reach the D1 report view. The booking
//      is cancelled afterwards.
//   3. --triage (default 3, at most 4) facilities requests through the Workflow; each
//      suggestion must come from Workers AI with a category in the enum. Each request is
//      cancelled afterwards, so the run never counts as a staff review. Every request
//      costs Workers AI neurons from the Free plan's 10,000 per day, which this account
//      shares with three other apps (Llama 3.3 70B: about 66 neurons per request), so the
//      count stays small.
//   4. CPU time in the window, from `wrangler tail` (wrangler's own OAuth login) and, with
//      CF_API_TOKEN holding Account Analytics Read, from the GraphQL Analytics API, judged
//      against the Workers Free plan's 10 ms.
//
// Free plan cost of a default run: about 200 to 250 Worker requests and as many Durable
// Object requests (Free: 100,000 a day each), a few hundred D1 rows, 3 Workflow instances
// and about 200 Workers AI neurons.
//
//   npm run prod:verify                             writes evals/results/production-verify.json
//   npm run prod:verify -- --person                 as the person signed in with
//                                                   `cloudflared access login <url>` (One-time PIN)
//   node scripts/prod-verify.ts --base-url http://localhost:8783 --dev-login emp_099 \
//     --expect-provider stub --no-cpu               rehearsal against a local preview (no file)
import { type ChildProcess, execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { CATEGORIES } from "../src/shared/triage/categories.ts";
import { CfApi, tokenFromEnv } from "./lib/cf-api.ts";
import { type GraphqlSummary, type TailSummary, WORKERS_CPU_QUERY, cpuUnitFromSchema, cpuVerdict, splitJsonStream, summarizeGraphql, summarizeTail } from "./lib/cpu-summary.ts";
import { percentile, round } from "./lib/eval-math.ts";
import { ROOT, runMeta } from "./lib/meta.ts";
import { ObserverModel, type ServerMessage } from "./lib/observer-model.ts";
import { type AttemptOutcome, type AvailabilityRow, PROD_TRIAGE_REQUESTS, checkDate, evaluateContention, pickWindow } from "./lib/prod-checks.ts";
import { PROD, PROD_URL } from "./lib/prod-config.ts";
import { credentialsFromEnv, readServiceToken, serviceTokenHeaders } from "./lib/service-token-file.ts";
import { childEnv } from "./lib/wrangler-cli.ts";

const { values: args } = parseArgs({
  options: {
    "base-url": { type: "string", default: PROD_URL },
    attempts: { type: "string", default: "200" },
    desks: { type: "string", default: "1" },
    triage: { type: "string", default: "3" },
    "expect-provider": { type: "string", default: "workers-ai" },
    person: { type: "boolean", default: false },
    "dev-login": { type: "string" },
    "no-cpu": { type: "boolean", default: false },
    "triage-timeout": { type: "string", default: "180" },
    out: { type: "string" },
  },
});

const BASE = String(args["base-url"]).replace(/\/$/, "");
const IS_PROD = BASE === PROD_URL;
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(BASE);
const ATTEMPTS = Number(args.attempts);
const DESKS = Number(args.desks);
const TRIAGE_N = Number(args.triage);
const EXPECT_PROVIDER = String(args["expect-provider"]);
const OUT = args.out ?? (IS_PROD ? "evals/results/production-verify.json" : null);
function usage(message: string): never {
  console.error(`prod-verify: ${message}`);
  process.exit(2);
}
if (!IS_PROD && !LOOPBACK) usage(`--base-url must be ${PROD_URL} or a loopback rehearsal server`);
if (args["dev-login"] && !LOOPBACK) usage("--dev-login is for a local rehearsal only");
if (args["dev-login"] && args.person) usage("--person and --dev-login are exclusive");
// Small on purpose: the Free plan allows 100,000 Worker requests a day for the whole account.
if (!Number.isInteger(ATTEMPTS) || ATTEMPTS < 2 || ATTEMPTS > 300) usage("--attempts must be 2 to 300 (a small check, not a load test)");
if (DESKS !== 1 && DESKS !== 2) usage("--desks must be 1 or 2");
// Workers AI neurons are shared with three other apps on this account.
if (!Number.isInteger(TRIAGE_N) || TRIAGE_N < 0 || TRIAGE_N > PROD_TRIAGE_REQUESTS.length) usage(`--triage must be 0 to ${PROD_TRIAGE_REQUESTS.length}`);

const log = (msg: string) => console.log(msg);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- auth ----------

type AuthMode = "service token" | "person (Access session)" | "dev login";

function execText(cmd: string, argv: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, argv, { env: childEnv(), timeout: 30_000 }, (err, stdout) => (err ? reject(new Error(`${cmd} ${argv[0]} ${argv[1]} failed`)) : resolve(stdout.trim())));
  });
}

async function authHeaders(): Promise<{ mode: AuthMode; headers: Record<string, string> }> {
  if (args["dev-login"]) {
    const res = await fetch(`${BASE}/api/dev/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId: args["dev-login"] }) });
    if (!res.ok) throw new Error(`dev login failed: ${res.status}`);
    return { mode: "dev login", headers: { "Cf-Access-Jwt-Assertion": ((await res.json()) as { token: string }).token } };
  }
  if (args.person) {
    let token = process.env.PLACESSYNC_ACCESS_TOKEN?.trim() ?? "";
    if (!token) {
      try {
        token = await execText("cloudflared", ["access", "token", `-app=${BASE}`]);
      } catch {
        throw new Error(`no Access session: run \`cloudflared access login ${BASE}\` (One-time PIN), or set PLACESSYNC_ACCESS_TOKEN`);
      }
    }
    if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(token)) throw new Error("the Access token does not look like a JWT; run cloudflared access login again");
    // Access reads an application token from this header and passes the verified
    // Cf-Access-Jwt-Assertion to the Worker (https://developers.cloudflare.com/cloudflare-one/tutorials/cli/).
    return { mode: "person (Access session)", headers: { "cf-access-token": token } };
  }
  const creds = credentialsFromEnv() ?? readServiceToken();
  if (!creds) throw new Error("no verification service token: run `npm run prod:setup` (it stores one in .prod/), or set PLACESSYNC_VERIFY_CLIENT_ID and PLACESSYNC_VERIFY_CLIENT_SECRET");
  return { mode: "service token", headers: serviceTokenHeaders(creds) };
}

let AUTH: Record<string, string> = {};

async function api<T>(method: string, p: string, body?: unknown): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${p}`, {
    method,
    redirect: "manual",
    headers: { ...AUTH, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (res.status >= 300 && res.status < 400) throw new Error(`${method} ${p} was redirected to ${res.headers.get("location")?.split("?")[0]}: Access did not accept the credentials`);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { nonJson: text.slice(0, 200) };
  }
  return { status: res.status, body: parsed as T };
}

// ---------- CPU sources ----------

interface TailHandle {
  child: ChildProcess;
  events: unknown[];
  connected: boolean;
  stderrTail: string;
}

/** Starts `wrangler tail --format json` in its own process group and waits until it connects. */
async function startTail(): Promise<TailHandle | null> {
  const child = spawn(path.join(ROOT, "node_modules", ".bin", "wrangler"), ["tail", PROD.workerName, "--format", "json"], {
    cwd: ROOT,
    env: childEnv(),
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  const h: TailHandle = { child, events: [], connected: false, stderrTail: "" };
  let buf = "";
  child.stdout?.on("data", (d: Buffer) => {
    buf += d.toString();
    const { values, rest } = splitJsonStream(buf);
    h.events.push(...values);
    buf = rest;
  });
  child.stderr?.on("data", (d: Buffer) => {
    h.stderrTail = (h.stderrTail + d.toString()).slice(-2000);
    if (/connected|Successfully created tail/i.test(h.stderrTail)) h.connected = true;
  });
  const deadline = Date.now() + 20_000;
  while (!h.connected && Date.now() < deadline && child.exitCode === null) await sleep(250);
  if (!h.connected) {
    stopGroup(child, "SIGTERM");
    log(`  wrangler tail did not connect (${h.stderrTail.split("\n").filter(Boolean).at(-1) ?? "no output"}); CPU from tail will be missing`);
    return null;
  }
  return h;
}

function stopGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // Already gone.
  }
}

async function stopTail(h: TailHandle): Promise<void> {
  // SIGINT lets wrangler delete its tail session before exiting.
  stopGroup(h.child, "SIGINT");
  const deadline = Date.now() + 10_000;
  while (h.child.exitCode === null && Date.now() < deadline) await sleep(200);
  stopGroup(h.child, "SIGKILL");
}

type Gql = { viewer: { accounts: { workersInvocationsAdaptive: import("./lib/cpu-summary.ts").GraphqlGroup[] }[] } };

/** Polls analytics until the window's request count stops growing (analytics lag several minutes; up to 15). */
async function graphqlCpu(cf: CfApi, start: Date, end: Date, minRequests: number): Promise<GraphqlSummary> {
  const vars = { accountTag: PROD.accountId, scriptName: PROD.workerName, start: start.toISOString(), end: end.toISOString() };
  const deadline = Date.now() + 15 * 60_000; // analytics took more than 6 minutes to ingest on 2026-10-15
  let last: GraphqlSummary | null = null;
  for (;;) {
    const s = summarizeGraphql(await cf.graphql<Gql>(WORKERS_CPU_QUERY, vars));
    if (last && s.requests >= minRequests && s.requests === last.requests) return s;
    last = s;
    if (Date.now() > deadline) return s;
    log(`  analytics: ${s.requests} requests in the window so far; waiting for it to settle`);
    await sleep(30_000);
  }
}

// ---------- live observer ----------

interface Observer {
  ws: WebSocket;
  model: ObserverModel;
  closes: number;
  closing: boolean;
}

function openObserver(date: string): Promise<Observer> {
  return new Promise((resolve, reject) => {
    // Node's WebSocket (undici) sends these headers on the upgrade, so Access sees the credentials.
    const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/api/sites/${PROD.siteId}/live`, { headers: AUTH } as never);
    const o: Observer = { ws, model: new ObserverModel([date]), closes: 0, closing: false };
    const timer = setTimeout(() => reject(new Error("no snapshot within 15 s")), 15_000);
    ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "subscribe", date })));
    ws.addEventListener("error", () => reject(new Error("socket error")));
    ws.addEventListener("close", () => {
      if (!o.closing) o.closes++;
    });
    ws.addEventListener("message", (e) => {
      const { resubscribe, snapshot } = o.model.handle(JSON.parse(String(e.data)) as ServerMessage);
      if (resubscribe) ws.send(JSON.stringify({ type: "subscribe", date: resubscribe }));
      if (snapshot) {
        clearTimeout(timer);
        resolve(o);
      }
    });
  });
}

// ---------- main ----------

interface Health {
  authMode: string;
  triage: string;
  seeded: boolean;
  siteToday: string | null;
  siteRules: { openMin: number; closeMin: number } | null;
}

type Suggestion = { category: string; provider: string; model: string; latencyMs: number; attempts: number; confidence: number };
type Detail = { request: { status: string }; suggestion: Suggestion | null };

async function main(): Promise<number> {
  const meta = runMeta({
    extra: {
      command: `node scripts/prod-verify.ts ${process.argv.slice(2).join(" ")}`.trim(),
      label: IS_PROD ? "production: deployed Worker on the Cloudflare Workers Free plan, through Cloudflare Access" : "local rehearsal (not production)",
      baseUrl: BASE,
    },
  });
  const runId = randomUUID().slice(0, 8);
  log(`prod-verify ${runId} against ${BASE}`);
  const auth = await authHeaders();
  AUTH = auth.headers;
  const apiToken = tokenFromEnv();
  const cfApi = apiToken ? new CfApi(PROD.accountId, apiToken) : null;
  const measureCpu = IS_PROD && !args["no-cpu"];

  const tail = measureCpu ? await startTail() : null;
  if (tail) {
    // Ctrl-C must not leave the detached tail session running.
    process.once("SIGINT", () => {
      stopGroup(tail.child, "SIGINT");
      process.exit(130);
    });
  }
  const windowStart = new Date();
  const gates: Record<string, boolean> = {};
  const cleanup: Record<string, unknown> = {};
  const result: Record<string, unknown> = { meta, target: { baseUrl: BASE, worker: IS_PROD ? PROD.workerName : null, plan: IS_PROD ? "Workers Free" : null }, cleanup };

  try {
    // 1. health and identity
    const health = await api<Health>("GET", "/api/health");
    const me = await api<{ employee: { id: string; role: string } }>("GET", "/api/me");
    if (health.status !== 200 || me.status !== 200) throw new Error(`health ${health.status}, me ${me.status}: ${JSON.stringify(health.status !== 200 ? health.body : me.body).slice(0, 200)}`);
    const role = me.body.employee.role;
    result.health = { authMode: health.body.authMode, triage: health.body.triage, seeded: health.body.seeded };
    result.principal = { id: me.body.employee.id, role, via: auth.mode };
    gates.health = health.body.seeded && health.body.triage === "ready" && (!IS_PROD || health.body.authMode === "access");
    log(`health: auth ${health.body.authMode}, triage ${health.body.triage}, seeded ${health.body.seeded}; signed in by ${auth.mode} as ${me.body.employee.id} (${role})`);
    if (!health.body.siteToday || !health.body.siteRules) throw new Error("the site is not seeded");

    // 2. contention
    const date = checkDate(health.body.siteToday);
    const avail = await api<{ resources: AvailabilityRow[] }>("GET", `/api/sites/${PROD.siteId}/availability?date=${date}&kind=desk`);
    const window = pickWindow(avail.body.resources ?? [], health.body.siteRules.openMin, health.body.siteRules.closeMin, DESKS);
    if (!window) throw new Error(`no free hour with ${DESKS} desk(s) on ${date}`);
    let observer: Observer | null = null;
    let observerError: string | null = null;
    try {
      observer = await openObserver(date);
    } catch (e) {
      observerError = e instanceof Error ? e.message : String(e);
    }
    log(`contention: ${ATTEMPTS} concurrent attempts on ${window.desks.join(" and ")}, ${date} ${window.startMin}-${window.endMin} min`);
    const outcomes: AttemptOutcome[] = await Promise.all(
      Array.from({ length: ATTEMPTS }, async (_, i) => {
        const resourceId = window.desks[i % window.desks.length] as string;
        const t0 = performance.now();
        try {
          const res = await fetch(`${BASE}/api/reservations`, {
            method: "POST",
            redirect: "manual",
            headers: { ...AUTH, "content-type": "application/json", "Idempotency-Key": `pv-${runId}-${i}` },
            body: JSON.stringify({ resourceId, date, startMin: window.startMin, endMin: window.endMin }),
          });
          const body = (await res.json().catch(() => ({}))) as { error?: string; reservation?: { id: string } };
          return { resourceId, status: res.status, error: body.error ?? null, reservationId: body.reservation?.id ?? null, ms: performance.now() - t0 };
        } catch {
          return { resourceId, status: 0, error: "transport", reservationId: null, ms: performance.now() - t0 };
        }
      }),
    );
    const mine = await api<{ reservations: { id: string; resourceId: string; date: string; startMin: number; endMin: number }[] }>(
      "GET",
      `/api/reservations?from=${date}&to=${date}&status=confirmed`,
    );
    const inWindow = (mine.body.reservations ?? []).filter((r) => window.desks.includes(r.resourceId) && r.startMin < window.endMin && window.startMin < r.endMin);
    const lat = outcomes.map((o) => o.ms);
    const contention = evaluateContention(outcomes, inWindow.length, { p50: round(percentile(lat, 50), 1), max: round(Math.max(...lat), 1) });
    const booked = outcomes.find((o) => o.status === 201);
    await sleep(3_000);
    const liveStats = observer
      ? {
          deltas: observer.model.deltas[date] ?? 0,
          gaps: observer.model.gaps,
          duplicates: observer.model.duplicates,
          errors: observer.model.errors,
          unexpectedCloses: observer.closes,
          sawBooking: booked ? observer.model.stateKeys(date).includes(`${booked.resourceId}|${window.startMin}|${window.endMin}`) : false,
        }
      : null;
    const live: Record<string, unknown> = liveStats ? { connected: true, ...liveStats } : { connected: false, error: observerError };
    result.contention = { date, window: { startMin: window.startMin, endMin: window.endMin }, desks: window.desks.length, ...contention };
    gates.contention = contention.passed;
    log(`  ${contention.accepted} confirmed, ${contention.rejectedResourceConflict} resource_conflict, ${contention.rejectedEmployeeConflict} employee_conflict, ${contention.serverErrors} server errors; ${contention.passed ? "passed" : `FAILED: ${contention.failures.join("; ")}`}`);
    log(`  live observer: ${JSON.stringify(live)}`);

    // D1 projection (only an admin can read the report view).
    let projection: Record<string, unknown> = { checked: false, reason: "needs a facilities admin sign-in (--person as the owner)" };
    if (role === "facilities_admin" && booked?.reservationId) {
      const t0 = Date.now();
      let seen = false;
      while (!seen && Date.now() - t0 < 120_000) {
        const facts = await api<{ facts: { reservationId: string; status: string }[] }>("GET", `/api/admin/reports/reservations?date=${date}`);
        seen = (facts.body.facts ?? []).some((f) => f.reservationId === booked.reservationId && f.status === "confirmed");
        if (!seen) await sleep(2_000);
      }
      projection = { checked: true, reachedD1: seen, lagMsUpperBound: Date.now() - t0 };
      gates.projection = seen;
    }
    result.projection = projection;

    if (booked?.reservationId) {
      const cancel = await api("POST", `/api/reservations/${booked.reservationId}/cancel`, { reason: `prod-verify ${runId} cleanup` });
      cleanup.reservationCancelled = cancel.status === 200;
    }
    if (observer) {
      await sleep(2_000);
      const key = booked ? `${booked.resourceId}|${window.startMin}|${window.endMin}` : null;
      live.sawRelease = key ? !observer.model.stateKeys(date).includes(key) : null;
      // Final counts, after the release delta.
      Object.assign(live, { deltas: observer.model.deltas[date] ?? 0, gaps: observer.model.gaps, duplicates: observer.model.duplicates, errors: observer.model.errors, unexpectedCloses: observer.closes });
      observer.closing = true;
      observer.ws.close();
    }
    result.live = live;
    // The booking's delta and then its release's, with no gap, duplicate or error.
    gates.live =
      live.connected === true &&
      live.sawBooking === true &&
      live.sawRelease === true &&
      live.gaps === 0 &&
      live.duplicates === 0 &&
      live.errors === 0 &&
      live.unexpectedCloses === 0;

    // 3. triage: submit each request, then wait for every suggestion.
    if (TRIAGE_N > 0) {
      const submitted: { id: string; expected: string; t0: number; started: string }[] = [];
      for (const r of PROD_TRIAGE_REQUESTS.slice(0, TRIAGE_N)) {
        const t0 = Date.now();
        const created = await api<{ request: { id: string }; triage: string }>("POST", "/api/requests", {
          siteId: PROD.siteId,
          title: r.title,
          description: `${r.description} (prod-verify ${runId})`,
        });
        if (created.status !== 201) throw new Error(`POST /api/requests answered ${created.status}: ${JSON.stringify(created.body).slice(0, 200)}`);
        submitted.push({ id: created.body.request.id, expected: r.category, t0, started: created.body.triage });
      }
      const timeoutMs = Number(args["triage-timeout"]) * 1000;
      const found = new Map<string, { detail: Detail; at: number }>();
      const deadline = Date.now() + timeoutMs;
      while (found.size < submitted.length && Date.now() < deadline) {
        for (const s of submitted) {
          if (found.has(s.id)) continue;
          const d = await api<Detail>("GET", `/api/requests/${s.id}`);
          if (d.status === 200 && d.body.suggestion) found.set(s.id, { detail: d.body, at: Date.now() });
        }
        if (found.size < submitted.length) await sleep(2_000);
      }
      const items = submitted.map((s) => {
        const hit = found.get(s.id);
        const sug = hit?.detail.suggestion ?? null;
        return {
          started: s.started,
          reachedReview: hit?.detail.request.status === "awaiting_review",
          provider: sug?.provider ?? null,
          model: sug?.model ?? null,
          category: sug?.category ?? null,
          expectedCategory: s.expected,
          confidence: sug?.confidence ?? null,
          categoryInEnum: sug ? (CATEGORIES as readonly string[]).includes(sug.category) : false,
          providerLatencyMs: sug?.latencyMs ?? null,
          providerAttempts: sug?.attempts ?? null,
          submitToSuggestionMsUpperBound: hit ? hit.at - s.t0 : null,
        };
      });
      const viaExpected = items.filter((i) => i.provider === EXPECT_PROVIDER).length;
      result.triage = {
        requests: items.length,
        expectedProvider: EXPECT_PROVIDER,
        viaExpectedProvider: viaExpected,
        categoryInEnum: items.filter((i) => i.categoryInEnum).length,
        // A handful of clear requests: a sanity check that the model answers, not an accuracy number.
        matchesWrittenCategory: items.filter((i) => i.category === i.expectedCategory).length,
        items,
      };
      gates.triage = items.every((i) => i.provider === EXPECT_PROVIDER && i.categoryInEnum);
      for (const i of items) log(`triage: ${i.provider ? `${i.provider} (${i.model}) suggested ${i.category}, written as ${i.expectedCategory}` : "no suggestion before the timeout"}`);
      let cancelled = 0;
      for (const s of submitted) if ((await api("POST", `/api/requests/${s.id}/cancel`)).status === 200) cancelled++;
      cleanup.requestsCancelled = `${cancelled} of ${submitted.length}`;
    } else {
      result.triage = { requests: 0, skipped: "--triage 0" };
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
    gates.completed = false;
    log(`stopped: ${String(result.error)}`);
  } finally {
    const windowEnd = new Date();
    result.window = { start: windowStart.toISOString(), end: windowEnd.toISOString() };
    let tailSummary: TailSummary | null = null;
    if (tail) {
      // Alarms and the Workflows' last steps run after the last request.
      await sleep(15_000);
      await stopTail(tail);
      tailSummary = summarizeTail(tail.events);
    }
    let gql: GraphqlSummary | null = null;
    let gqlError: string | null = null;
    let unit: Awaited<ReturnType<typeof cpuUnitFromSchema>> | null = null;
    if (measureCpu && cfApi) {
      try {
        unit = await cpuUnitFromSchema(cfApi);
        gql = await graphqlCpu(cfApi, new Date(windowStart.getTime() - 60_000), new Date(Date.now() + 60_000), ATTEMPTS + 5);
      } catch (e) {
        gqlError = e instanceof Error ? e.message : String(e);
      }
    }
    const verdict = measureCpu ? cpuVerdict(tailSummary, gql, unit?.microseconds ?? false) : { verdict: "not measured (rehearsal)", reasons: [] };
    result.cpu = {
      limitMs: 10,
      tail: tailSummary,
      graphql: gql,
      graphqlCpuUnit: unit,
      graphqlError: measureCpu ? (cfApi ? gqlError : "no CF_API_TOKEN with Account Analytics Read") : null,
      ...verdict,
    };
    if (measureCpu) gates.cpu = verdict.verdict === "fits";
  }

  result.gates = gates;
  result.passed = Object.values(gates).every(Boolean);
  // A run that never got past sign-in has nothing to record.
  if (OUT && result.health) {
    const file = path.resolve(ROOT, OUT);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
    log(`wrote ${path.relative(ROOT, file)}`);
  }
  log(`gates: ${JSON.stringify(gates)}`);
  const cpu = result.cpu as { verdict: string; reasons: string[] };
  log(`CPU: ${cpu.verdict}${cpu.reasons.length ? ` (${cpu.reasons.join("; ")})` : ""}`);
  if (measureCpu && cpu.verdict === "unmeasured") return 2;
  return result.passed ? 0 : 1;
}

if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((e: unknown) => {
      console.error(`prod-verify failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
