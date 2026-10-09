// Renders the README Results block from the committed evals/results/*.json (SPEC 12.3).
// Refuses (non-zero exit) any file from a dirty tree or whose git SHA is not an ancestor
// of HEAD, so only clean-commit runs reach the README.
//
//   node scripts/render-results.ts           rewrites the block in README.md
//   node scripts/render-results.ts --stdout  prints the block
//   node scripts/render-results.ts --stdout --dir <path>
//                                            prints the block for every *.json in <path>
//                                            (fixtures; never writes README.md)
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./lib/meta.ts";

export const START = "<!-- results:start -->";
export const END = "<!-- results:end -->";

interface Meta {
  gitSha: string;
  dirty: boolean;
  timestamp: string;
  command?: string;
  node?: string;
  os?: string;
  cpu?: string;
}

export class ResultsRefused extends Error {}

function isAncestor(sha: string, cwd: string): boolean {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Committed result files (tracked by git), or every *.json under dir when files are given. */
export function trackedResultFiles(root: string = ROOT): string[] {
  const out = execFileSync("git", ["ls-files", "evals/results/*.json"], { cwd: root, encoding: "utf8" }).trim();
  return out ? out.split("\n").map((f) => path.join(root, f)) : [];
}

export function loadResults(files: readonly string[], gitCwd: string = ROOT): Record<string, { meta: Meta } & Record<string, unknown>> {
  const out: Record<string, { meta: Meta } & Record<string, unknown>> = {};
  for (const file of files) {
    const name = path.basename(file, ".json");
    const data = JSON.parse(readFileSync(file, "utf8")) as { meta?: Meta } & Record<string, unknown>;
    if (!data.meta) throw new ResultsRefused(`${name}: no meta block`);
    if (data.meta.dirty) throw new ResultsRefused(`${name}: produced on a dirty tree (meta.dirty = true)`);
    if (!isAncestor(data.meta.gitSha, gitCwd)) throw new ResultsRefused(`${name}: git SHA ${data.meta.gitSha} is not an ancestor of HEAD`);
    out[name] = data as { meta: Meta } & Record<string, unknown>;
  }
  return out;
}

const pct = (x: unknown) => (typeof x === "number" ? `${(x * 100).toFixed(1)}%` : "n/a");
const num = (x: unknown) => (typeof x === "number" ? x.toLocaleString("en-US") : "n/a");
const provenance = (m: Meta) =>
  `Command: \`${m.command ?? "unknown"}\`. Run ${m.timestamp.slice(0, 10)} at commit \`${m.gitSha.slice(0, 7)}\` on ${m.cpu ?? "unknown CPU"} (${m.os ?? "unknown OS"}, Node ${m.node ?? "?"}).`;

function contentionSection(r: Record<string, unknown> & { meta: Meta }): string {
  const runs = r.runs as Record<string, unknown>[];
  const gen = r.generator as Record<string, unknown>;
  const control = (r.control as { naiveD1?: Record<string, unknown> } | null)?.naiveD1;
  const first = runs[0] ?? {};
  const spread = (v: number[]) => {
    const lo = Math.min(...v);
    const hi = Math.max(...v);
    return lo === hi ? num(lo) : `${num(lo)} to ${num(hi)}`;
  };
  const range = (k: string) => spread(runs.map((x) => Number(x[k])));
  const causes = runs.map((x) => x.transportRetryCauses as { connectErrors: number; proxyFetchFailed: number } | undefined);
  const lat = first.latencyMs as { p50: number; p95: number; p99: number };
  return [
    "### Reservation contention (local workerd)",
    "",
    provenance(r.meta),
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Runs | ${runs.length} |`,
    `| Attempts per run (date A / date B) | ${num(first.attempts)} (${num((first.attemptsPerDate as { A: number }).A)} / ${num((first.attemptsPerDate as { B: number }).B)}) |`,
    `| Attempts overlapping another attempt (generator) | ${num(gen.contestedAttempts)} |`,
    `| Accepted | ${range("accepted")} |`,
    `| Rejected: resource conflict / employee conflict | ${range("rejectedResourceConflict")} / ${range("rejectedEmployeeConflict")} |`,
    `| **Overlapping confirmed bookings** | **${range("overlappingConfirmedPairs")}** |`,
    `| Employee double bookings | ${range("employeeDoubleBookingPairs")} |`,
    `| Unjustified rejections, phantom or lost acceptances | ${range("unjustifiedRejections")}, ${range("phantomAcceptances")}, ${range("lostAcceptances")} |`,
    `| Validation errors, server errors | ${range("rejectedValidation")}, ${range("serverErrors")} |`,
    `| D1 projection mismatches | ${range("projectionMismatches")} |`,
    `| Live observers: date-version gaps, foreign-date messages, final-state mismatches | ${range("observerDateVersionGaps")}, ${range("observerForeignDateMessages")}, ${range("observerFinalStateMismatches")} |`,
    // Earlier results wrote observerResubscribes as a constant 0 (their observers never
    // resubscribed), so this row appears only for results whose observers measure it; the
    // same script change added observerConnectRetries.
    ...(runs.every((x) => x.observerConnectRetries !== undefined)
      ? [
          `| Live observers: resubscribes after a gap, duplicate deltas, unexpected closes | ${range("observerResubscribes")}, ${range("observerDuplicateDeltas")}, ${range("observerUnexpectedCloses")} |`,
          `| Observer connect retries (before any attempt is fired) | ${range("observerConnectRetries")} |`,
        ]
      : []),
    `| Slot-key backstop activations | ${range("backstopHits")} |`,
    // Results that record each retry's cause get one row per cause; older ones, one total.
    ...(causes.every((c) => c !== undefined)
      ? [
          `| Transport retries: connections refused or reset before any response (resent with the same Idempotency-Key) | ${spread(causes.map((c) => c?.connectErrors ?? 0))} |`,
          `| Transport retries: the vite preview proxy's own "fetch failed" 500 page (resent with the same Idempotency-Key) | ${spread(causes.map((c) => c?.proxyFetchFailed ?? 0))} |`,
        ]
      : runs.every((x) => x.transportRetries !== undefined)
        ? [`| Transport retries (refused connects or dev-proxy failures, resent with the same Idempotency-Key) | ${range("transportRetries")} |`]
        : []),
    `| Negative control (naive read-then-write D1): accepted, overlapping pairs | ${control ? `${num(control.accepted)}, ${num(control.overlappingPairs)}` : "not run"} |`,
    `| Latency p50 / p95 / p99, run 1 (local, single machine) | ${lat?.p50} / ${lat?.p95} / ${lat?.p99} ms |`,
    "",
    `All gates in SPEC 13.1 ${(r.gates as { passed: boolean }).passed ? "passed" : "FAILED"}.`,
  ].join("\n");
}

function triageSection(name: string, r: Record<string, unknown> & { meta: Meta }): string {
  const provider = r.provider as { id: string; model: string; label: string };
  const llm = (r.meta as { llm?: { modelPath: string | null; nCtxPerSlot: number; totalSlots: number; maxPromptTokens: number } }).llm;
  const sets = r.sets as Record<string, Record<string, unknown>>;
  const base = r.keywordBaseline as Record<string, { accuracy: number; macroF1: number }>;
  const rows = Object.entries(sets).map(([set, s]) => {
    const lat = s.latencyMs as { p50: number; p95: number };
    return `| ${set} | ${num(s.n)} | ${pct(s.accuracy)} | ${(s.macroF1 as number).toFixed(3)} | ${pct(s.schemaValidFirstTry)} | ${pct(s.fallbackRate)} | ${lat.p50} / ${lat.p95} ms | ${pct(base[set]?.accuracy)} |`;
  });
  const title = provider.id === "stub" ? "Keyword stub (keyword-v1), not an LLM" : `${provider.model}${llm?.modelPath ? ` (${llm.modelPath}, llama.cpp, ${llm.nCtxPerSlot} tokens per slot)` : ""}`;
  const inj = sets.injection as { n: number; steered?: number; steerRate?: number } | undefined;
  const injBase = base.injection as { steered?: number } | undefined;
  return [
    `### Triage classification: ${title}`,
    "",
    provenance(r.meta),
    "",
    "| Set | Items | Accuracy | Macro-F1 | Schema-valid first try | Keyword fallback | Latency p50 / p95 | Keyword baseline accuracy |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
    "",
    ...(inj?.steered !== undefined
      ? [
          `Injection set: each of the ${num(inj.n)} requests carries text that tries to force a different category (a forged answer, a fake system line, an override claim, a closing tag). The prediction equalled the forced category on ${num(inj.steered)} of ${num(inj.n)} (steer rate ${pct(inj.steerRate)}; keyword baseline ${num(injBase?.steered)} of ${num(inj.n)}).`,
          "",
        ]
      : []),
    ...(provider.id === "openai-compat"
      ? ["llama-server constrains the output to the JSON schema (`response_format` json_schema, strict), so schema validity reflects the decoder, not the model.", ""]
      : []),
    `Source file: \`evals/results/${name}.json\`.`,
  ].join("\n");
}

function workflowSection(r: Record<string, unknown> & { meta: Meta }): string {
  const lat = r.endToEndLatencyMs as { p50: number; p95: number };
  const providerCounts = r.providerCounts as Record<string, number>;
  const counts = Object.entries(providerCounts)
    .map(([k, v]) => `${k}: ${num(v)}`)
    .join(", ");
  // Name the model only when the Workflow's suggestions actually came from it.
  const modelPath = (r.meta as { llm?: { modelPath?: string | null } }).llm?.modelPath;
  const subject = (providerCounts["openai-compat"] ?? 0) > 0 && modelPath ? `${modelPath} via llama.cpp` : "no suggestion from a model";
  const gates = r.gates as { passed: boolean; failures?: string[] };
  return [
    `### Triage through the Workflow (local server, ${subject})`,
    "",
    provenance(r.meta),
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Requests submitted through the API | ${num(r.n)} |`,
    `| Reached awaiting_review with a suggestion | ${num(r.reachedReview)} |`,
    `| Suggestion providers | ${counts || "none"} |`,
    `| Category inside the four-category enum | ${num(r.categoryInEnum)} |`,
    `| Suggestion equals the template label | ${pct(r.agreementWithLabel)} |`,
    `| Submit to awaiting_review, p50 / p95 (local) | ${lat.p50} / ${lat.p95} ms |`,
    "",
    // Results written before the provider gate existed record only `passed`.
    gates.failures === undefined
      ? `Workflow-mode gates of that script version (every request reached review, every category in the enum) ${gates.passed ? "passed" : "FAILED"}.`
      : `Workflow-mode gates (every request reached review with a category in the enum, and every suggestion came from openai-compat or its keyword fallback) ${gates.passed ? "passed" : "FAILED"}.`,
  ].join("\n");
}

/** "passed" only when the keyboard spec ran and every run of it passed; an empty list is "not run". */
export function keyboardStatus(paths: readonly { passed: boolean }[] | undefined): string {
  if (!paths || paths.length === 0) return "not run";
  return paths.every((k) => k.passed) ? "passed" : "failed";
}

function e2eSection(r: Record<string, unknown> & { meta: Meta }): string {
  const s = r.summary as Record<string, unknown>;
  return [
    "### End-to-end checks (Playwright, Chromium)",
    "",
    provenance(r.meta),
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Tests passed | ${num(s.passed)} of ${num(s.tests)} |`,
    `| axe scans (WCAG 2.0 A/AA, 2.1 AA, 2.2 AA) and violations | ${num(s.axeScans)} scans, ${num(s.axeViolations)} violations |`,
    `| Layout checks at 375x812 and 768x1024 and failures | ${num(s.overflowChecks)} checks, ${num(s.overflowFailures)} failures |`,
    `| Keyboard-only booking and cancellation | ${keyboardStatus(s.keyboardPaths as { passed: boolean }[] | undefined)} |`,
    ...(s.realtimeLatencyMs
      ? [
          `| Live update propagation, ${num((s.realtimeLatencyMs as { bookings: number }).bookings)} bookings, p50 / p95 (local Chromium, booking request to busy cell in a second browser) | ${Math.round((s.realtimeLatencyMs as { p50: number }).p50)} / ${Math.round((s.realtimeLatencyMs as { p95: number }).p95)} ms |`,
        ]
      : []),
  ].join("\n");
}

export function renderBlock(results: Record<string, { meta: Meta } & Record<string, unknown>>): string {
  const names = Object.keys(results).sort();
  if (names.length === 0) return "No results have been recorded yet. Numbers appear here only after `npm run results` renders committed, clean-tree eval output.";
  const parts: string[] = [];
  if (results.contention) parts.push(contentionSection(results.contention));
  for (const n of names.filter((n) => n.startsWith("triage-") && n !== "triage-workflow-local").sort((a, b) => (a === "triage-keyword" ? 1 : b === "triage-keyword" ? -1 : a.localeCompare(b)))) {
    parts.push(triageSection(n, results[n] as { meta: Meta } & Record<string, unknown>));
  }
  if (results["triage-workflow-local"]) parts.push(workflowSection(results["triage-workflow-local"]));
  if (results.e2e) parts.push(e2eSection(results.e2e));
  return parts.join("\n\n");
}

export function replaceBlock(readme: string, block: string): string {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) throw new Error("README.md has no results markers");
  return `${readme.slice(0, a + START.length)}\n${block}\n${readme.slice(b)}`;
}

export function currentBlock(readme: string): string {
  const a = readme.indexOf(START);
  const b = readme.indexOf(END);
  if (a < 0 || b < a) throw new Error("README.md has no results markers");
  return readme.slice(a + START.length, b).replace(/^\n/, "").replace(/\n$/, "");
}

if (import.meta.main) {
  try {
    const args = process.argv.slice(2);
    const dirAt = args.indexOf("--dir");
    const dir = dirAt >= 0 ? args[dirAt + 1] : undefined;
    if (dirAt >= 0 && (!dir || !args.includes("--stdout"))) throw new Error("--dir <path> needs a path and is allowed only with --stdout");
    const files = dir
      ? readdirSync(dir)
          .filter((f) => f.endsWith(".json"))
          .map((f) => path.resolve(dir, f))
      : trackedResultFiles();
    const block = renderBlock(loadResults(files));
    if (args.includes("--stdout")) {
      console.log(block);
    } else {
      const file = path.join(ROOT, "README.md");
      writeFileSync(file, replaceBlock(readFileSync(file, "utf8"), block));
      console.log("README.md results block updated");
    }
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
