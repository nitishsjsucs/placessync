import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ResultsRefused, loadResults, renderBlock, replaceBlock, currentBlock } from "../../scripts/render-results.ts";

const root = path.join(import.meta.dirname, "..", "..");
const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();

function fixture(name: string, meta: Record<string, unknown>, body: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "placessync-results-"));
  const file = path.join(dir, `${name}.json`);
  writeFileSync(file, JSON.stringify({ meta: { timestamp: "2026-10-08T00:00:00.000Z", ...meta }, ...body }));
  return file;
}

const e2eBody = { summary: { passed: 2, tests: 2, axeScans: 1, axeViolations: 0, overflowChecks: 1, overflowFailures: 0, keyboardPaths: [{ passed: true }] } };

describe("render-results refusals (SPEC 12.3)", () => {
  it("refuses a result produced on a dirty tree", () => {
    const file = fixture("e2e", { gitSha: head, dirty: true }, e2eBody);
    expect(() => loadResults([file], root)).toThrow(ResultsRefused);
    expect(() => loadResults([file], root)).toThrow(/dirty/);
  });

  it("refuses a result whose git SHA is not an ancestor of HEAD", () => {
    const file = fixture("e2e", { gitSha: "0123456789abcdef0123456789abcdef01234567", dirty: false }, e2eBody);
    expect(() => loadResults([file], root)).toThrow(/not an ancestor/);
  });

  it("refuses a file without a meta block", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "placessync-results-"));
    const file = path.join(dir, "e2e.json");
    writeFileSync(file, JSON.stringify(e2eBody));
    expect(() => loadResults([file], root)).toThrow(/no meta/);
  });

  it("renders a clean result at an ancestor commit, with its command and date", () => {
    const file = fixture("e2e", { gitSha: head, dirty: false, command: "npm run test:e2e" }, e2eBody);
    const block = renderBlock(loadResults([file], root));
    expect(block).toContain("Command: `npm run test:e2e`. Run 2026-10-08");
    expect(block).toContain("| Tests passed | 2 of 2 |");
  });

  it("the render-results command exits non-zero on a dirty file and prints the refusal", () => {
    const file = fixture("contention", { gitSha: head, dirty: true });
    const cli = (...args: string[]) => spawnSync(process.execPath, [path.join(root, "scripts", "render-results.ts"), ...args], { cwd: root, encoding: "utf8" });
    const refused = cli("--stdout", "--dir", path.dirname(file));
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("contention: produced on a dirty tree (meta.dirty = true)");
    expect(refused.stdout).toBe("");
    // The same command renders a clean fixture and exits 0, so the refusal above is the dirty flag.
    const clean = fixture("e2e", { gitSha: head, dirty: false, command: "npm run test:e2e" }, e2eBody);
    const ok = cli("--stdout", "--dir", path.dirname(clean));
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain("| Tests passed | 2 of 2 |");
    // --dir never rewrites README.md.
    expect(cli("--dir", path.dirname(clean)).status).toBe(1);
  });

  it("reports the keyboard path as passed only when the keyboard spec ran and passed", () => {
    const render = (keyboardPaths: { passed: boolean }[]) =>
      renderBlock(loadResults([fixture("e2e", { gitSha: head, dirty: false }, { summary: { ...e2eBody.summary, keyboardPaths } })], root));
    expect(render([{ passed: true }])).toContain("| Keyboard-only booking and cancellation | passed |");
    expect(render([{ passed: false }])).toContain("| Keyboard-only booking and cancellation | failed |");
    const none = render([]);
    expect(none).toContain("| Keyboard-only booking and cancellation | not run |");
    expect(none).not.toContain("cancellation | passed");
  });

  it("shows observer resubscribes only for contention results whose observers measure them", () => {
    const run = {
      attempts: 1000,
      attemptsPerDate: { A: 700, B: 300 },
      latencyMs: { p50: 1, p95: 2, p99: 3 },
      observerResubscribes: 0,
      observerDuplicateDeltas: 0,
      observerUnexpectedCloses: 0,
    };
    const body = (extra: Record<string, unknown>) => ({ generator: { contestedAttempts: 984 }, runs: [{ ...run, ...extra }], control: null, gates: { passed: true } });
    const older = renderBlock(loadResults([fixture("contention", { gitSha: head, dirty: false }, body({}))], root));
    expect(older).not.toContain("resubscribes after a gap");
    const newer = renderBlock(loadResults([fixture("contention", { gitSha: head, dirty: false }, body({ observerConnectRetries: 2 }))], root));
    expect(newer).toContain("| Live observers: resubscribes after a gap, duplicate deltas, unexpected closes | 0, 0, 0 |");
    expect(newer).toContain("| Observer connect retries (before any attempt is fired) | 2 |");
  });

  it("names the model in the workflow section only when its suggestions came from it", () => {
    const meta = { gitSha: head, dirty: false, llm: { modelPath: "Qwen3-1.7B-Q4_0-rtn.gguf" } };
    const body = (providerCounts: Record<string, number>, gates: Record<string, unknown>) => ({
      mode: "workflow",
      n: 2,
      reachedReview: 2,
      providerCounts,
      categoryInEnum: 2,
      agreementWithLabel: 1,
      endToEndLatencyMs: { p50: 1, p95: 2 },
      gates,
    });
    const model = renderBlock(loadResults([fixture("triage-workflow-local", meta, body({ "openai-compat": 2 }, { passed: true, failures: [] }))], root));
    expect(model).toContain("### Triage through the Workflow (local server, Qwen3-1.7B-Q4_0-rtn.gguf via llama.cpp)");
    expect(model).toContain("and every suggestion came from openai-compat or its keyword fallback) passed.");
    const stub = renderBlock(loadResults([fixture("triage-workflow-local", meta, body({ stub: 2 }, { passed: false, failures: ["no suggestion came from openai-compat"] }))], root));
    expect(stub).toContain("### Triage through the Workflow (local server, no suggestion from a model)");
    expect(stub).not.toContain("llama.cpp");
    expect(stub).toContain("| Suggestion providers | stub: 2 |");
    expect(stub).toContain(") FAILED.");
    const older = renderBlock(loadResults([fixture("triage-workflow-local", meta, body({ "openai-compat": 2 }, { passed: true }))], root));
    expect(older).toContain("Workflow-mode gates of that script version (every request reached review, every category in the enum) passed.");
  });

  it("reports the injection steer rate and the constrained-decoding note for a model run", () => {
    const set = { n: 12, accuracy: 0.75, macroF1: 0.7, schemaValidFirstTry: 1, fallbackRate: 0, latencyMs: { p50: 1, p95: 2 } };
    const body = (id: string) => ({
      provider: { id, model: id === "stub" ? "keyword-v1" : "qwen3-1.7b", label: "x" },
      sets: { hard: { ...set, n: 40 }, injection: { ...set, steered: 2, steerRate: 0.1667 } },
      keywordBaseline: { hard: { accuracy: 0.65 }, injection: { accuracy: 0.9, steered: 1, steerRate: 0.0833 } },
    });
    const model = renderBlock(loadResults([fixture("triage-qwen3-1.7b", { gitSha: head, dirty: false, llm: { modelPath: "m.gguf", nCtxPerSlot: 8192 } }, body("openai-compat"))], root));
    expect(model).toContain("| injection | 12 | 75.0% |");
    expect(model).toContain("The prediction equalled the forced category on 2 of 12 (steer rate 16.7%; keyword baseline 1 of 12).");
    expect(model).toContain("so schema validity reflects the decoder, not the model.");
    const stub = renderBlock(loadResults([fixture("triage-keyword", { gitSha: head, dirty: false }, body("stub"))], root));
    expect(stub).not.toContain("reflects the decoder");
  });

  it("replaces only the block between the markers", () => {
    const readme = "# T\n\n<!-- results:start -->\nold\n<!-- results:end -->\n\nafter\n";
    const next = replaceBlock(readme, "new block");
    expect(next).toBe("# T\n\n<!-- results:start -->\nnew block\n<!-- results:end -->\n\nafter\n");
    expect(currentBlock(next)).toBe("new block");
  });
});

describe("README results block (SPEC 12.3)", () => {
  it("equals render-results output for the committed evals/results/*.json", async () => {
    const { readFileSync } = await import("node:fs");
    const { trackedResultFiles } = await import("../../scripts/render-results.ts");
    const readme = readFileSync(path.join(root, "README.md"), "utf8");
    const expected = renderBlock(loadResults(trackedResultFiles(root), root));
    expect(currentBlock(readme)).toBe(expected);
  });
});
