// prod-verify's pure parts: the contention verdict, the window it books, the CPU summaries
// from wrangler tail and GraphQL analytics with their verdict against the Free plan's
// 10 ms, and the README section, which refuses anything but a run against the deployed
// Worker.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ResultsRefused, loadResults, renderBlock } from "../../scripts/render-results.ts";
import { cpuVerdict, splitJsonStream, summarizeGraphql, summarizeTail, tailKind } from "../../scripts/lib/cpu-summary.ts";
import { type AttemptOutcome, checkDate, evaluateContention, pickWindow } from "../../scripts/lib/prod-checks.ts";

const root = path.join(import.meta.dirname, "..", "..");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

const attempt = (status: number, error: string | null, resourceId = "d1"): AttemptOutcome => ({ resourceId, status, error, reservationId: status === 201 ? "r1" : null, ms: 10 });

describe("evaluateContention", () => {
  it("passes with exactly one confirmation and only conflict rejections", () => {
    const outcomes = [attempt(201, null), ...Array.from({ length: 9 }, () => attempt(409, "resource_conflict")), ...Array.from({ length: 10 }, () => attempt(409, "employee_conflict", "d2"))];
    const r = evaluateContention(outcomes, 1, { p50: 10, max: 10 });
    expect(r).toMatchObject({ attempts: 20, accepted: 1, rejectedResourceConflict: 9, rejectedEmployeeConflict: 10, otherRejections: 0, passed: true, failures: [] });
  });

  it("fails on a double booking, a server error, a missing response or an unexpected rejection", () => {
    expect(evaluateContention([attempt(201, null), attempt(201, null, "d2")], 2, { p50: 1, max: 1 }).failures).toEqual([
      "2 attempts were confirmed, want exactly 1",
      "2 confirmed bookings in the window afterwards, want exactly 1",
    ]);
    const r = evaluateContention([attempt(201, null), attempt(500, "internal"), attempt(0, "transport"), attempt(422, "validation")], 1, { p50: 1, max: 1 });
    expect(r.passed).toBe(false);
    expect(r.failures).toEqual(["1 server errors", "1 attempts got no response", "1 attempts were rejected for another reason"]);
  });
});

describe("pickWindow and checkDate", () => {
  const desk = (id: string, busy: { startMin: number; endMin: number; mine: boolean }[] = []) => ({ resource: { id, kind: "desk", active: true }, busy });

  it("takes the first hour with two free desks and none held by the person", () => {
    const rows = [desk("a", [{ startMin: 420, endMin: 480, mine: false }]), desk("b"), desk("c", [{ startMin: 480, endMin: 540, mine: true }]), { resource: { id: "r", kind: "room", active: true }, busy: [] }];
    // 07:00 has only b and c free; 08:00 is excluded because the person holds c then.
    expect(pickWindow(rows, 420, 1140)).toEqual({ startMin: 420, endMin: 480, desks: ["b", "c"] });
    const busy = [desk("a", [{ startMin: 420, endMin: 1140, mine: false }]), desk("b")];
    expect(pickWindow(busy, 420, 1140)).toBeNull();
  });

  it("books two business days out", () => {
    expect(checkDate("2026-10-15")).toBe("2026-10-19");
    expect(checkDate("2026-10-19")).toBe("2026-10-21");
  });
});

describe("CPU summaries", () => {
  it("splits wrangler's pretty-printed tail events, keeping an unfinished one for later", () => {
    const a = JSON.stringify({ outcome: "ok", event: { request: { url: "https://x/api/me" } }, cpuTime: 1 }, null, 2);
    const b = JSON.stringify({ outcome: "ok", note: "a } brace in a string" }, null, 2);
    const { values, rest } = splitJsonStream(`${a}\n${b}\n{"outcome": "ok", "cpu`);
    expect(values).toHaveLength(2);
    expect(rest).toBe('{"outcome": "ok", "cpu');
    expect(splitJsonStream(rest + 'Time": 3}').values).toEqual([{ outcome: "ok", cpuTime: 3 }]);
  });

  it("groups tail events by entrypoint and event kind and counts limit outcomes", () => {
    const events = [
      { outcome: "ok", event: { request: { url: "u" } }, cpuTime: 2 },
      { outcome: "ok", event: { request: { url: "u" } }, cpuTime: 12 },
      { outcome: "ok", entrypoint: "SiteLedger", executionModel: "durableObject", event: { rpcMethod: "reserve" }, cpuTime: 1 },
      { outcome: "exceededCpu", entrypoint: "SiteLedger", executionModel: "durableObject", event: { scheduledTime: 1 } },
      { outcome: "ok", event: { cron: "*/2 * * * *", scheduledTime: 1 }, cpuTime: 0.5 },
      { event: { type: "overload", message: "sampling" } },
    ];
    expect(tailKind(events[2] as never)).toBe("SiteLedger:rpc reserve");
    expect(tailKind(events[4] as never)).toBe("default:cron");
    const s = summarizeTail(events);
    expect(s.all).toMatchObject({ invocations: 5, withCpuTime: 4, maxMs: 12, overLimit: 1, limitOutcomes: 1 });
    expect(Object.keys(s.byKind)).toEqual(["default:cron", "default:fetch", "SiteLedger:alarm", "SiteLedger:rpc reserve"]);
    expect(cpuVerdict(s, null).verdict).toBe("exceeds");
  });

  it("reads GraphQL quantiles in microseconds and judges p99 against 10 ms", () => {
    const data = {
      viewer: {
        accounts: [
          {
            workersInvocationsAdaptive: [
              { dimensions: { status: "success" }, sum: { requests: 40, errors: 0, subrequests: 90 }, quantiles: { cpuTimeP50: 900, cpuTimeP99: 4200 } },
              { dimensions: { status: "clientDisconnected" }, sum: { requests: 1, errors: 0, subrequests: 0 }, quantiles: { cpuTimeP50: 300, cpuTimeP99: 300 } },
            ],
          },
        ],
      },
    };
    const g = summarizeGraphql(data);
    expect(g).toMatchObject({ requests: 41, p50Ms: 0.9, p99Ms: 4.2, limitOutcomes: 0, statuses: { success: 40, clientDisconnected: 1 } });
    expect(cpuVerdict(null, g)).toEqual({ verdict: "fits", reasons: [] });
    const slow = summarizeGraphql({ viewer: { accounts: [{ workersInvocationsAdaptive: [{ dimensions: { status: "exceededCpu" }, sum: { requests: 2, errors: 2, subrequests: 0 }, quantiles: { cpuTimeP50: 11000, cpuTimeP99: 15000 } }] }] } });
    expect(cpuVerdict(null, slow).verdict).toBe("exceeds");
  });

  it("claims nothing when no source returned CPU time", () => {
    const noCpu = summarizeTail([{ outcome: "ok", event: { request: { url: "u" } } }]);
    expect(cpuVerdict(noCpu, null).verdict).toBe("unmeasured");
    expect(cpuVerdict(null, null).verdict).toBe("unmeasured");
  });
});

describe("README production section", () => {
  function fixture(target: Record<string, unknown>): string {
    const dir = mkdtempSync(path.join(os.tmpdir(), "placessync-prod-"));
    const file = path.join(dir, "production-verify.json");
    writeFileSync(
      file,
      JSON.stringify({
        meta: { gitSha: head, dirty: false, timestamp: "2026-10-20T00:00:00.000Z", command: "npm run prod:verify" },
        target,
        principal: { role: "facilities_admin" },
        contention: { attempts: 20, accepted: 1, rejectedResourceConflict: 9, rejectedEmployeeConflict: 10, otherRejections: 0, serverErrors: 0, confirmedInWindow: 1 },
        live: { sawBooking: true, sawRelease: true, gaps: 0, duplicates: 0 },
        projection: { checked: true, reachedD1: true, lagMsUpperBound: 1500 },
        triage: { provider: "workers-ai", model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", category: "building_systems", submitToSuggestionMsUpperBound: 2400, providerLatencyMs: 900 },
        cpu: { verdict: "unmeasured", reasons: ["neither wrangler tail nor GraphQL analytics returned CPU time"], tail: null, graphql: null, graphqlError: "no account API token with Account Analytics Read" },
        gates: { health: true, contention: true, live: true, projection: true, triage: true, cpu: false },
        passed: false,
      }),
    );
    return file;
  }

  it("renders a run against the deployed Worker, naming the failed gate", () => {
    const block = renderBlock(loadResults([fixture({ baseUrl: "https://placessync-production.nitish-ratakonda.workers.dev", worker: "placessync-production", plan: "Workers Free" })], root));
    expect(block).toContain("### Production verification (deployed Worker, Cloudflare Workers Free plan)");
    expect(block).toContain("| Triage through the Workflow: provider, model, category | workers-ai, @cf/meta/llama-3.3-70b-instruct-fp8-fast, building_systems |");
    expect(block).toContain("| CPU per invocation against the Free plan's 10 ms | unmeasured (neither wrangler tail nor GraphQL analytics returned CPU time) |");
    expect(block).toContain("Failed gates: cpu.");
  });

  it("refuses a local rehearsal", () => {
    const file = fixture({ baseUrl: "http://localhost:8783", worker: null, plan: null });
    expect(() => renderBlock(loadResults([file], root))).toThrow(ResultsRefused);
  });
});
