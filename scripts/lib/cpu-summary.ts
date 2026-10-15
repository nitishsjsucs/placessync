// CPU time of the deployed Worker, from the two sources Cloudflare documents
// (https://developers.cloudflare.com/workers/platform/limits/#cpu-time):
// - `wrangler tail --format json`, one trace event per invocation (fetch, cron, Durable
//   Object alarm or RPC, Workflow step), with CPU time at the top level when the platform
//   includes it;
// - the GraphQL Analytics API's workersInvocationsAdaptive dataset (CPU quantiles in
//   microseconds per status), which needs an API token with Account Analytics Read.
// prod-verify records whichever it gets and judges it against the Free plan's 10 ms.
import { CPU_MS_PER_INVOCATION } from "../../src/worker/free-plan.ts";
import { percentile, round } from "./eval-math.ts";

export const CPU_LIMIT_MS = CPU_MS_PER_INVOCATION;

/** Outcomes the platform reports when an invocation hit a resource limit. */
export const LIMIT_OUTCOMES = new Set(["exceededCpu", "exceededMemory", "exceededResources"]);

/**
 * Splits concatenated JSON values (wrangler prints each tail event pretty-printed, one
 * after another) into parsed values plus the unfinished remainder.
 */
export function splitJsonStream(buffer: string): { values: unknown[]; rest: string } {
  const values: unknown[] = [];
  let depth = 0;
  let inString = false;
  let start = -1;
  let consumed = 0;
  for (let i = 0; i < buffer.length; i++) {
    const ch = buffer[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          values.push(JSON.parse(buffer.slice(start, i + 1)));
        } catch {
          // Not JSON after all (a stray brace in a status line); skip it.
        }
        consumed = i + 1;
        start = -1;
      } else if (depth < 0) {
        depth = 0;
        consumed = i + 1;
      }
    }
  }
  return { values, rest: depth > 0 && start >= 0 ? buffer.slice(start) : buffer.slice(consumed).replace(/^[^{]*/, "") };
}

export interface TailEvent {
  outcome?: string;
  scriptName?: string | null;
  entrypoint?: string | null;
  executionModel?: string;
  eventTimestamp?: number;
  cpuTime?: number;
  wallTime?: number;
  event?: Record<string, unknown> | null;
}

/** "SiteLedger:alarm", "default:fetch", "TriageWorkflow:rpc run", and so on. */
export function tailKind(e: TailEvent): string {
  const ev = e.event ?? {};
  const who = e.entrypoint || (e.executionModel === "durableObject" ? "durableObject" : "default");
  let what = "other";
  if ("request" in ev) what = "fetch";
  else if ("cron" in ev) what = "cron";
  else if ("rpcMethod" in ev) what = `rpc ${String(ev.rpcMethod)}`;
  else if ("scheduledTime" in ev) what = "alarm";
  else if ("getWebSocketEvent" in ev) what = "websocket";
  return `${who}:${what}`;
}

export interface CpuStats {
  invocations: number;
  withCpuTime: number;
  p50Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  overLimit: number;
  limitOutcomes: number;
}

function stats(events: TailEvent[]): CpuStats {
  const cpu = events.map((e) => e.cpuTime).filter((x): x is number => typeof x === "number").sort((a, b) => a - b);
  return {
    invocations: events.length,
    withCpuTime: cpu.length,
    p50Ms: cpu.length ? round(percentile(cpu, 50), 2) : null,
    p99Ms: cpu.length ? round(percentile(cpu, 99), 2) : null,
    maxMs: cpu.length ? round(cpu[cpu.length - 1] as number, 2) : null,
    overLimit: cpu.filter((x) => x > CPU_LIMIT_MS).length,
    limitOutcomes: events.filter((e) => LIMIT_OUTCOMES.has(String(e.outcome))).length,
  };
}

export interface TailSummary {
  source: "wrangler tail";
  all: CpuStats;
  byKind: Record<string, CpuStats>;
  outcomes: Record<string, number>;
}

export function summarizeTail(raw: unknown[]): TailSummary {
  // Tail info messages (overload notices) carry no invocation.
  const events = raw.filter((x): x is TailEvent => typeof x === "object" && x !== null && "outcome" in x);
  const byKind: Record<string, TailEvent[]> = {};
  const outcomes: Record<string, number> = {};
  for (const e of events) {
    (byKind[tailKind(e)] ??= []).push(e);
    const o = String(e.outcome);
    outcomes[o] = (outcomes[o] ?? 0) + 1;
  }
  return {
    source: "wrangler tail",
    all: stats(events),
    byKind: Object.fromEntries(Object.entries(byKind).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stats(v)])),
    outcomes,
  };
}

export const WORKERS_CPU_QUERY = `query PlacesSyncCpu($accountTag: string, $scriptName: string, $start: string, $end: string) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      workersInvocationsAdaptive(limit: 100, filter: { scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end }) {
        dimensions { status }
        sum { requests errors subrequests }
        quantiles { cpuTimeP50 cpuTimeP99 }
      }
    }
  }
}`;

export interface GraphqlGroup {
  dimensions: { status: string };
  sum: { requests: number; errors: number; subrequests: number };
  quantiles: { cpuTimeP50: number; cpuTimeP99: number };
}

export interface GraphqlSummary {
  source: "GraphQL workersInvocationsAdaptive";
  requests: number;
  errors: number;
  subrequests: number;
  statuses: Record<string, number>;
  /** Highest per-status quantile, in ms (the API reports microseconds). */
  p50Ms: number | null;
  p99Ms: number | null;
  limitOutcomes: number;
}

export function summarizeGraphql(data: { viewer: { accounts: { workersInvocationsAdaptive: GraphqlGroup[] }[] } }): GraphqlSummary {
  const groups = data.viewer.accounts[0]?.workersInvocationsAdaptive ?? [];
  const statuses: Record<string, number> = {};
  for (const g of groups) statuses[g.dimensions.status] = (statuses[g.dimensions.status] ?? 0) + g.sum.requests;
  const max = (f: (g: GraphqlGroup) => number) => (groups.length ? round(Math.max(...groups.map(f)) / 1000, 2) : null);
  return {
    source: "GraphQL workersInvocationsAdaptive",
    requests: groups.reduce((n, g) => n + g.sum.requests, 0),
    errors: groups.reduce((n, g) => n + g.sum.errors, 0),
    subrequests: groups.reduce((n, g) => n + g.sum.subrequests, 0),
    statuses,
    p50Ms: max((g) => g.quantiles.cpuTimeP50),
    p99Ms: max((g) => g.quantiles.cpuTimeP99),
    limitOutcomes: groups.filter((g) => LIMIT_OUTCOMES.has(g.dimensions.status)).reduce((n, g) => n + g.sum.requests, 0),
  };
}

/**
 * Reads the unit of workersInvocationsAdaptive's CPU quantiles from the GraphQL schema
 * (introspection), so the results file records what the API says instead of assuming it.
 * summarizeGraphql divides by 1,000 (microseconds to ms); the verdict is only trusted when
 * the description returned here says microseconds.
 */
export async function cpuUnitFromSchema(cf: { graphql<T>(q: string, v: Record<string, unknown>): Promise<T> }): Promise<{ field: string; description: string | null; microseconds: boolean }> {
  type Field = { name: string; description: string | null; type: { name: string | null; ofType: { name: string | null; ofType: { name: string | null } | null } | null } };
  const typeOf = (f: Field) => f.type.name ?? f.type.ofType?.name ?? f.type.ofType?.ofType?.name ?? null;
  const fields = async (name: string): Promise<Field[]> =>
    (
      await cf.graphql<{ __type: { fields: Field[] } | null }>(
        "query PlacesSyncType($name: String!) { __type(name: $name) { fields { name description type { name ofType { name ofType { name } } } } } }",
        { name },
      )
    ).__type?.fields ?? [];
  const step = async (typeName: string | null, field: string): Promise<string | null> => {
    if (!typeName) return null;
    const f = (await fields(typeName)).find((x) => x.name === field);
    return f ? typeOf(f) : null;
  };
  const root = (await cf.graphql<{ __schema: { queryType: { name: string } } }>("query { __schema { queryType { name } } }", {})).__schema.queryType.name;
  const viewer = await step(root, "viewer");
  const account = await step(viewer, "accounts");
  const group = await step(account, "workersInvocationsAdaptive");
  const quantiles = await step(group, "quantiles");
  const cpu = quantiles ? (await fields(quantiles)).find((x) => x.name === "cpuTimeP50") : undefined;
  const description = cpu?.description ?? null;
  return { field: `${quantiles ?? "?"}.cpuTimeP50`, description, microseconds: /microsecond/i.test(description ?? "") };
}

export type CpuVerdict = "fits" | "exceeds" | "unmeasured";

/**
 * fits: CPU time was measured and no invocation hit a limit or went over 10 ms (tail), and
 * the p99 is under 10 ms (GraphQL). exceeds: any of those failed. unmeasured: neither
 * source produced CPU numbers, so nothing is claimed.
 */
export function cpuVerdict(tail: TailSummary | null, gql: GraphqlSummary | null, gqlUnitIsMicroseconds = true): { verdict: CpuVerdict; reasons: string[] } {
  const reasons: string[] = [];
  let measured = false;
  if (gql && !gqlUnitIsMicroseconds) {
    // Without the schema saying microseconds, the analytics numbers are kept in the file but not judged.
    reasons.push("analytics CPU quantiles not judged: the schema did not confirm they are microseconds");
    gql = null;
  }
  if (tail) {
    if (tail.all.limitOutcomes > 0) reasons.push(`${tail.all.limitOutcomes} tail invocation(s) ended with a resource-limit outcome`);
    if (tail.all.withCpuTime > 0) {
      measured = true;
      if (tail.all.overLimit > 0) reasons.push(`${tail.all.overLimit} tail invocation(s) used more than ${CPU_LIMIT_MS} ms CPU (max ${tail.all.maxMs} ms)`);
    }
  }
  if (gql && gql.requests > 0 && gql.p99Ms !== null) {
    measured = true;
    if (gql.limitOutcomes > 0) reasons.push(`${gql.limitOutcomes} request(s) with a resource-limit status in analytics`);
    if (gql.p99Ms > CPU_LIMIT_MS) reasons.push(`analytics CPU p99 ${gql.p99Ms} ms is over ${CPU_LIMIT_MS} ms`);
  }
  const notes = reasons.filter((r) => r.startsWith("analytics CPU quantiles not judged"));
  const problems = reasons.filter((r) => !notes.includes(r));
  if (problems.length) return { verdict: "exceeds", reasons };
  if (!measured) return { verdict: "unmeasured", reasons: [...notes, "neither wrangler tail nor GraphQL analytics returned CPU time"] };
  return { verdict: "fits", reasons: notes };
}
