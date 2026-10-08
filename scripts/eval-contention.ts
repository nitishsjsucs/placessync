// Contention eval (SPEC 13.1): 1,000 generated reservation attempts over two dates,
// fired concurrently at a running local server, with live observers on both dates and a
// deliberately unsafe D1 booker as the negative control. Writes JSON with a meta block.
//
//   node scripts/eval-contention.ts --base-url http://localhost:8783 --runs 1 --observers 4 \
//     --control naive-d1 --out evals/results/contention.json
//
// Every gate in SPEC 13.1 is checked; any violation makes the script exit non-zero.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { countOverlappingPairsBy, overlaps } from "../src/shared/intervals.ts";
import { SEED, contentionStats, generateContentionAttempts, type ContentionAttempt } from "../src/shared/synthetic/index.ts";
import { addBusinessDays } from "../src/shared/time.ts";
import { percentile, round } from "./lib/eval-math.ts";
import { ROOT, runMeta } from "./lib/meta.ts";
import { ObserverModel, type ServerMessage } from "./lib/observer-model.ts";

const { values: args } = parseArgs({
  options: {
    "base-url": { type: "string", default: "http://localhost:8783" },
    runs: { type: "string", default: "1" },
    observers: { type: "string", default: "4" },
    control: { type: "string", default: "naive-d1" },
    out: { type: "string", default: "evals/results/contention.json" },
  },
});

const BASE = String(args["base-url"]).replace(/\/$/, "");
const RUNS = Number(args.runs);
const OBSERVERS = Number(args.observers);
if (![2, 4].includes(OBSERVERS)) throw new Error("--observers must be 2 or 4");

const attempts = generateContentionAttempts(SEED);
const meta = runMeta({ seed: SEED, input: attempts, extra: { command: `node scripts/eval-contention.ts ${process.argv.slice(2).join(" ")}`, baseUrl: BASE, runs: RUNS, observers: OBSERVERS, control: args.control, label: "local workerd via vite preview, single machine" } });

interface Reservation {
  id: string;
  resourceId: string;
  employeeId: string;
  kind: "desk" | "room";
  date: string;
  startMin: number;
  endMin: number;
}

async function json<T>(res: Response): Promise<T> {
  const text = await res.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`non-JSON response ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function seed(): Promise<void> {
  const res = await fetch(`${BASE}/api/dev/seed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reset: true, history: false }) });
  const body = await json<{ employees: number; resources: number }>(res);
  if (!res.ok || body.employees !== 100 || body.resources !== 20) throw new Error(`seed failed: ${res.status} ${JSON.stringify(body)}`);
}

async function mintTokens(): Promise<Map<string, string>> {
  const tokens = new Map<string, string>();
  for (let n = 1; n <= 100; n++) {
    const id = `emp_${String(n).padStart(3, "0")}`;
    const res = await fetch(`${BASE}/api/dev/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ employeeId: id }) });
    if (!res.ok) throw new Error(`login ${id}: ${res.status}`);
    tokens.set(id, (await json<{ token: string }>(res)).token);
  }
  return tokens;
}

const auth = (token: string) => ({ "Cf-Access-Jwt-Assertion": token });

// ---------- observers ----------

interface ObserverState {
  name: string;
  ws: WebSocket;
  model: ObserverModel;
  unexpectedCloses: number;
  closing: boolean;
  lastMessageAt: number;
}

/**
 * Opens one admin observer and resolves once every subscribed date has its snapshot.
 * Messages go through ObserverModel, which applies deltas as the client does and
 * resubscribes a date after a gap (scripts/lib/observer-model.ts).
 */
function openObserver(name: string, dates: string[], token: string): Promise<ObserverState> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${BASE.replace(/^http/, "ws")}/api/sites/hq/live`, { headers: auth(token) } as never);
    const state: ObserverState = { name, ws, model: new ObserverModel(dates), unexpectedCloses: 0, closing: false, lastMessageAt: Date.now() };
    const pending = new Set(dates);
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        // Never opened.
      }
      reject(new Error(message));
    };
    const timer = setTimeout(() => fail(`observer ${name}: no snapshot`), 15_000);
    ws.addEventListener("open", () => {
      for (const d of dates) ws.send(JSON.stringify({ type: "subscribe", date: d }));
    });
    ws.addEventListener("error", () => fail(`observer ${name}: socket error`));
    ws.addEventListener("close", () => {
      if (!settled) fail(`observer ${name}: closed before its snapshots`);
      else if (!state.closing) state.unexpectedCloses++;
    });
    ws.addEventListener("message", (e) => {
      state.lastMessageAt = Date.now();
      const { resubscribe, snapshot } = state.model.handle(JSON.parse(String(e.data)) as ServerMessage);
      if (resubscribe) ws.send(JSON.stringify({ type: "subscribe", date: resubscribe }));
      if (snapshot) {
        pending.delete(snapshot);
        if (pending.size === 0 && !settled) {
          settled = true;
          clearTimeout(timer);
          resolve(state);
        }
      }
    });
  });
}

/**
 * Observers connect before any attempt is fired, so retrying a failed connect (a
 * transient local error under load) cannot change a measured outcome. Retries are counted.
 */
async function openObserverWithRetry(name: string, dates: string[], token: string, onRetry: () => void): Promise<ObserverState> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await openObserver(name, dates, token);
    } catch (err) {
      if (attempt >= 4) throw err;
      console.warn(`${err instanceof Error ? err.message : String(err)}; retrying`);
      onRetry();
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    }
  }
}

async function quiet(observers: ObserverState[], quietMs = 500, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (observers.every((o) => Date.now() - o.lastMessageAt >= quietMs)) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}

// ---------- one run ----------

interface Outcome {
  attempt: ContentionAttempt;
  date: string;
  status: number;
  error: string | null;
  reservationId: string | null;
  latencyMs: number;
}

/**
 * Transport failures below the Worker are retried with the same Idempotency-Key, which
 * the ledger replays safely, and counted:
 * - a burst of 1,000 connects can overflow the local listen queue (macOS caps it at
 *   kern.ipc.somaxconn, 128 by default), which refuses the connection;
 * - the vite preview server proxies to workerd and, under that burst, can answer an HTML
 *   500 "fetch failed" page of its own. The Worker always answers JSON, so an HTML 500
 *   never comes from the application.
 */
async function postWithRetry(url: string, init: RequestInit, onRetry: () => void): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let res: Response | null = null;
    try {
      res = await fetch(url, init);
    } catch (err) {
      if (attempt >= 8) throw err;
    }
    if (res) {
      const proxyFailure = res.status === 500 && !(res.headers.get("content-type") ?? "").includes("application/json");
      if (!proxyFailure || attempt >= 8) return res;
      await res.body?.cancel();
    }
    onRetry();
    await new Promise((r) => setTimeout(r, 50 * 2 ** Math.min(attempt, 5)));
  }
}

async function fire(path: string, tokens: Map<string, string>, dates: { A: string; B: string }): Promise<{ outcomes: Outcome[]; wallMs: number; transportRetries: number }> {
  const started = performance.now();
  let transportRetries = 0;
  const outcomes = await Promise.all(
    attempts.map(async (attempt): Promise<Outcome> => {
      const date = attempt.dayOffset === 2 ? dates.A : dates.B;
      const t0 = performance.now();
      const res = await postWithRetry(
        `${BASE}${path}`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "Idempotency-Key": attempt.idempotencyKey, ...auth(tokens.get(attempt.employeeId) ?? "") },
          body: JSON.stringify({ resourceId: attempt.resourceId, date, startMin: attempt.startMin, endMin: attempt.endMin, attendees: attempt.attendees }),
        },
        () => transportRetries++,
      );
      const body = await json<{ error?: string; reservation?: { id: string } }>(res);
      return { attempt, date, status: res.status, error: body.error ?? null, reservationId: body.reservation?.id ?? null, latencyMs: performance.now() - t0 };
    }),
  );
  return { outcomes, wallMs: performance.now() - started, transportRetries };
}

async function exportLedger(admin: string, date: string): Promise<Reservation[]> {
  const res = await fetch(`${BASE}/api/admin/ledger/export?date=${date}`, { headers: auth(admin) });
  return (await json<{ reservations: Reservation[] }>(res)).reservations;
}

async function run(index: number): Promise<Record<string, unknown>> {
  await seed();
  const tokens = await mintTokens();
  const admin = tokens.get("emp_100") ?? "";
  const health = await json<{ siteToday: string }>(await fetch(`${BASE}/api/health`));
  const dates = { A: addBusinessDays(health.siteToday, 2), B: addBusinessDays(health.siteToday, 3) };

  const plan: [string, string[]][] =
    OBSERVERS === 4
      ? [
          ["obs1_A", [dates.A]],
          ["obs2_A", [dates.A]],
          ["obs3_B", [dates.B]],
          ["obs4_AB", [dates.A, dates.B]],
        ]
      : [
          ["obs1_A", [dates.A]],
          ["obs2_B", [dates.B]],
        ];
  let observerConnectRetries = 0;
  const observers = await Promise.all(plan.map(([name, ds]) => openObserverWithRetry(name, ds, admin, () => observerConnectRetries++)));

  const { outcomes, wallMs, transportRetries } = await fire("/api/reservations", tokens, dates);
  await quiet(observers);

  const ledger = [...(await exportLedger(admin, dates.A)), ...(await exportLedger(admin, dates.B))];
  const ledgerIds = new Set(ledger.map((r) => r.id));
  const accepted = outcomes.filter((o) => o.status === 201);
  const acceptedIds = new Set(accepted.map((o) => o.reservationId));
  const acceptedPerDate = { A: accepted.filter((o) => o.date === dates.A).length, B: accepted.filter((o) => o.date === dates.B).length };

  const unjustified = outcomes.filter((o) => {
    if (o.status !== 409) return false;
    const want = { startMin: o.attempt.startMin, endMin: o.attempt.endMin };
    if (o.error === "resource_conflict") return !ledger.some((r) => r.resourceId === o.attempt.resourceId && r.date === o.date && overlaps(r, want));
    if (o.error === "employee_conflict") return !ledger.some((r) => r.employeeId === o.attempt.employeeId && r.kind === o.attempt.kind && r.date === o.date && overlaps(r, want));
    return true;
  }).length;

  // D1 projection: wait for the outbox to drain, then compare field by field.
  const drainStart = performance.now();
  let status = { outboxDepth: -1, backstopHits: 0 };
  for (let i = 0; i < 600; i++) {
    status = await json<{ outboxDepth: number; backstopHits: number }>(await fetch(`${BASE}/api/admin/projection/status`, { headers: auth(admin) }));
    if (status.outboxDepth === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const projectionDrainMs = performance.now() - drainStart;
  let projectionMismatches = 0;
  for (const date of [dates.A, dates.B]) {
    const facts = (await json<{ facts: (Reservation & { reservationId: string; status: string })[] }>(await fetch(`${BASE}/api/admin/reports/reservations?date=${date}`, { headers: auth(admin) }))).facts.filter(
      (f) => f.status === "confirmed",
    );
    const fromLedger = ledger.filter((r) => r.date === date);
    const key = (r: { resourceId: string; employeeId: string; startMin: number; endMin: number }) => `${r.resourceId}|${r.employeeId}|${r.startMin}|${r.endMin}`;
    const byId = new Map(facts.map((f) => [f.reservationId, f]));
    for (const r of fromLedger) {
      const f = byId.get(r.id);
      if (!f || key(f) !== key(r)) projectionMismatches++;
    }
    projectionMismatches += Math.max(0, facts.length - fromLedger.length);
  }

  // Observers: deltas per subscribed date must equal the acceptances on that date, and
  // each observer's reconstructed state must equal the ledger.
  const observerDeltas: Record<string, Record<string, number>> = {};
  let observerFinalStateMismatches = 0;
  for (const o of observers) {
    observerDeltas[o.name] = { ...o.model.deltas };
    for (const d of o.model.dates) {
      const truth = ledger
        .filter((r) => r.date === d)
        .map((r) => `${r.resourceId}|${r.startMin}|${r.endMin}`)
        .sort();
      if (JSON.stringify(o.model.stateKeys(d)) !== JSON.stringify(truth)) observerFinalStateMismatches++;
    }
    o.closing = true;
    o.ws.close();
  }
  const observerDeltaMismatches = observers.reduce(
    (n, o) => n + o.model.dates.filter((d) => (o.model.deltas[d] ?? 0) !== (d === dates.A ? acceptedPerDate.A : acceptedPerDate.B)).length,
    0,
  );
  const sum = (f: (o: ObserverState) => number) => observers.reduce((n, o) => n + f(o), 0);

  const latencies = outcomes.map((o) => o.latencyMs);
  return {
    run: index + 1,
    dates,
    attempts: outcomes.length,
    attemptsPerDate: { A: outcomes.filter((o) => o.date === dates.A).length, B: outcomes.filter((o) => o.date === dates.B).length },
    distinctEmployees: new Set(attempts.map((a) => a.employeeId)).size,
    distinctResources: new Set(attempts.map((a) => a.resourceId)).size,
    accepted: accepted.length,
    acceptedPerDate,
    rejectedResourceConflict: outcomes.filter((o) => o.error === "resource_conflict").length,
    rejectedEmployeeConflict: outcomes.filter((o) => o.error === "employee_conflict").length,
    rejectedValidation: outcomes.filter((o) => o.status === 422).length,
    serverErrors: outcomes.filter((o) => o.status >= 500).length,
    otherStatuses: outcomes.filter((o) => ![201, 409, 422].includes(o.status) && o.status < 500).length,
    overlappingConfirmedPairs: countOverlappingPairsBy(ledger, (r) => `${r.resourceId}|${r.date}`),
    employeeDoubleBookingPairs: countOverlappingPairsBy(ledger, (r) => `${r.employeeId}|${r.kind}|${r.date}`),
    unjustifiedRejections: unjustified,
    phantomAcceptances: [...acceptedIds].filter((id) => !id || !ledgerIds.has(id)).length,
    lostAcceptances: ledger.filter((r) => !acceptedIds.has(r.id)).length,
    projectionMismatches,
    projectionDrainMs: Math.round(projectionDrainMs),
    observerDeltas,
    observerDeltaMismatches,
    observerDateVersionGaps: sum((o) => o.model.gaps),
    observerResubscribes: sum((o) => o.model.resubscribes),
    observerDuplicateDeltas: sum((o) => o.model.duplicates),
    observerForeignDateMessages: sum((o) => o.model.foreign),
    observerErrors: sum((o) => o.model.errors),
    observerUnexpectedCloses: sum((o) => o.unexpectedCloses),
    observerConnectRetries,
    observerFinalStateMismatches,
    backstopHits: status.backstopHits,
    transportRetries,
    latencyMs: { p50: round(percentile(latencies, 50), 1), p95: round(percentile(latencies, 95), 1), p99: round(percentile(latencies, 99), 1) },
    wallMs: Math.round(wallMs),
    throughputRps: round(outcomes.length / (wallMs / 1000), 1),
  };
}

async function control(): Promise<Record<string, unknown>> {
  await seed();
  const tokens = await mintTokens();
  const admin = tokens.get("emp_100") ?? "";
  const reset = await fetch(`${BASE}/api/dev/naive/reset`, { method: "POST", headers: auth(admin) });
  if (!reset.ok) throw new Error(`naive reset: ${reset.status}`);
  const health = await json<{ siteToday: string }>(await fetch(`${BASE}/api/health`));
  const dates = { A: addBusinessDays(health.siteToday, 2), B: addBusinessDays(health.siteToday, 3) };
  const { outcomes, transportRetries } = await fire("/api/dev/naive/reserve", tokens, dates);
  const rows: Reservation[] = [];
  for (const d of [dates.A, dates.B]) {
    rows.push(...(await json<{ reservations: Reservation[] }>(await fetch(`${BASE}/api/dev/naive/export?date=${d}`, { headers: auth(admin) }))).reservations);
  }
  return {
    accepted: outcomes.filter((o) => o.status === 201).length,
    rows: rows.length,
    serverErrors: outcomes.filter((o) => o.status >= 500).length,
    transportRetries,
    overlappingPairs: countOverlappingPairsBy(rows, (r) => `${r.resourceId}|${r.date}`),
  };
}

// ---------- main ----------

const stats = contentionStats(attempts);
const runs: Record<string, unknown>[] = [];
for (let i = 0; i < RUNS; i++) {
  console.log(`run ${i + 1} of ${RUNS}`);
  runs.push(await run(i));
}
const naive = args.control === "naive-d1" ? await control() : null;

const failures: string[] = [];
const gate = (ok: boolean, message: string) => {
  if (!ok) failures.push(message);
};
for (const r of runs) {
  const n = (k: string) => Number(r[k]);
  const label = `run ${r.run}`;
  gate(n("attempts") === 1000, `${label}: attempts ${n("attempts")} != 1000`);
  gate(JSON.stringify(r.attemptsPerDate) === JSON.stringify({ A: 700, B: 300 }), `${label}: attemptsPerDate`);
  gate(n("distinctEmployees") === 100 && n("distinctResources") === 20, `${label}: distinct employees/resources`);
  for (const k of ["rejectedValidation", "serverErrors", "otherStatuses", "overlappingConfirmedPairs", "employeeDoubleBookingPairs", "unjustifiedRejections", "phantomAcceptances", "lostAcceptances", "projectionMismatches", "observerDeltaMismatches", "observerDateVersionGaps", "observerResubscribes", "observerDuplicateDeltas", "observerForeignDateMessages", "observerErrors", "observerUnexpectedCloses", "observerFinalStateMismatches"]) {
    gate(n(k) === 0, `${label}: ${k} = ${n(k)}`);
  }
}
if (naive) gate(Number(naive.accepted) > 0 && Number(naive.overlappingPairs) > 0, "control: the naive booker produced no overlaps, so the detector is unproven");

const pick = (k: string) => runs.map((r) => Number(r[k]));
const result = {
  meta,
  generator: stats,
  runs,
  summary: {
    runs: runs.length,
    overlappingConfirmedPairs: { min: Math.min(...pick("overlappingConfirmedPairs")), max: Math.max(...pick("overlappingConfirmedPairs")) },
    accepted: { min: Math.min(...pick("accepted")), max: Math.max(...pick("accepted")) },
    employeeDoubleBookingPairs: { max: Math.max(...pick("employeeDoubleBookingPairs")) },
    projectionMismatches: { max: Math.max(...pick("projectionMismatches")) },
    backstopHits: { max: Math.max(...pick("backstopHits")) },
  },
  control: naive ? { naiveD1: naive } : null,
  gates: { passed: failures.length === 0, failures },
};

const out = path.isAbsolute(String(args.out)) ? String(args.out) : path.join(ROOT, String(args.out));
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ summary: result.summary, control: result.control, gates: result.gates }, null, 2));
console.log(`wrote ${path.relative(ROOT, out)}${meta.dirty ? " (dirty tree: npm run results will refuse it)" : ""}`);
if (failures.length > 0) process.exit(1);
