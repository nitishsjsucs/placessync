// Triage classifier eval (SPEC 13.2), classifier mode.
//
//   node scripts/eval-triage.ts --provider openai-compat --base-url http://127.0.0.1:8130/v1 \
//     --model qwen3-1.7b --set all --out evals/results/triage-qwen3-1.7b.json
//   node scripts/eval-triage.ts --provider stub --set all --out evals/results/triage-keyword.json
//
// For openai-compat it first pre-flights every prompt through llama-server's
// /apply-template and /tokenize against the per-slot context from /props, and refuses to
// run if any prompt plus max_tokens does not fit. Each item is classified like the
// Workflow step does it: up to 3 attempts, then the keyword fallback. A context overflow
// during the run fails the run, so accuracy only ever reflects the model.
import { readFileSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { SEED, generateLabeledRequests } from "../src/shared/synthetic/index.ts";
import { CATEGORIES, type Category } from "../src/shared/triage/categories.ts";
import { classifyRequest, triageRequest } from "../src/shared/triage/classify.ts";
import { classifyByKeywords } from "../src/shared/triage/keyword-classifier.ts";
import { MAX_TOKENS, renderRequest } from "../src/shared/triage/prompt.ts";
import { OpenAiCompatProvider } from "../src/shared/triage/providers/openai-compatible.ts";
import { StubProvider } from "../src/shared/triage/providers/stub.ts";
import { ContextOverflowError, type LlmProvider } from "../src/shared/triage/providers/types.ts";
import { accuracy, confusionMatrix, macroF1, perClass, percentile, round } from "./lib/eval-math.ts";
import { ROOT, runMeta } from "./lib/meta.ts";

const { values: args } = parseArgs({
  options: {
    provider: { type: "string", default: "stub" },
    "base-url": { type: "string", default: "http://127.0.0.1:8130/v1" },
    model: { type: "string", default: "qwen3-1.7b" },
    set: { type: "string", default: "all" },
    out: { type: "string" },
    mode: { type: "string", default: "classifier" },
  },
});

if (args.mode !== "classifier") {
  console.error("Only --mode classifier is implemented in v1 (workflow mode is Tier 2).");
  process.exit(2);
}

interface Item {
  id: string;
  category: Category;
  title: string;
  description: string;
  resourceName?: string | null;
  locationNote?: string | null;
}

const MAX_ATTEMPTS = 3; // the Workflow classify step: 1 try plus 2 retries

function loadSets(which: string): Record<string, Item[]> {
  const sets: Record<string, Item[]> = {};
  if (which === "all" || which === "templated") {
    sets.templated = generateLabeledRequests(SEED).map((r) => ({ id: r.id, category: r.category, title: r.title, description: r.description, locationNote: r.locationNote }));
  }
  if (which === "all" || which === "hard") {
    sets.hard = readFileSync(path.join(ROOT, "evals", "data", "triage-hard.jsonl"), "utf8")
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as Item);
  }
  if (Object.keys(sets).length === 0) throw new Error("--set must be all, templated or hard");
  return sets;
}

const sets = loadSets(String(args.set));
const allItems = Object.values(sets).flat();
const server = String(args["base-url"]).replace(/\/v1\/?$/, "");

async function preflight(provider: OpenAiCompatProvider) {
  const props = (await (await fetch(`${server}/props`)).json()) as {
    default_generation_settings?: { n_ctx?: number };
    total_slots?: number;
    model_path?: string;
  };
  const nCtx = props.default_generation_settings?.n_ctx;
  const totalSlots = props.total_slots ?? 1;
  if (!nCtx) throw new Error("pre-flight: /props has no default_generation_settings.n_ctx");
  const counts: number[] = [];
  for (const item of allItems) {
    const body = provider.body({ ...triageRequest(item), maxTokens: MAX_TOKENS });
    const tmpl = (await (await fetch(`${server}/apply-template`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: body.messages, chat_template_kwargs: body.chat_template_kwargs }) })).json()) as { prompt?: string };
    if (typeof tmpl.prompt !== "string") throw new Error("pre-flight: /apply-template returned no prompt");
    const tok = (await (await fetch(`${server}/tokenize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: tmpl.prompt }) })).json()) as { tokens?: unknown[] };
    const n = tok.tokens?.length ?? 0;
    if (n + MAX_TOKENS > nCtx) {
      console.error(`pre-flight failed: ${item.id} needs ${n} prompt tokens + ${MAX_TOKENS} > n_ctx ${nCtx}`);
      process.exit(3);
    }
    counts.push(n);
  }
  let modelBytes: number | null = null;
  try {
    modelBytes = props.model_path ? statSync(props.model_path).size : null;
  } catch {
    modelBytes = null;
  }
  return {
    nCtxPerSlot: nCtx,
    totalSlots,
    maxPromptTokens: Math.max(...counts),
    p95PromptTokens: round(percentile(counts, 95), 1),
    // Basename only: the absolute path would leak the local home directory.
    modelPath: props.model_path ? path.basename(props.model_path) : null,
    modelBytes,
  };
}

interface ItemResult {
  id: string;
  set: string;
  truth: Category;
  predicted: Category;
  attempts: number;
  schemaValidFirstTry: boolean;
  fallback: boolean;
  latencyMs: number;
  errors: string[];
}

async function classifyItem(provider: LlmProvider, item: Item, set: string): Promise<ItemResult> {
  const errors: string[] = [];
  const t0 = performance.now();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const c = await classifyRequest(provider, item);
      return { id: item.id, set, truth: item.category, predicted: c.category, attempts: attempt, schemaValidFirstTry: attempt === 1, fallback: false, latencyMs: performance.now() - t0, errors };
    } catch (err) {
      if (err instanceof ContextOverflowError) throw err;
      errors.push(err instanceof Error ? err.message.slice(0, 160) : String(err));
    }
  }
  const k = classifyByKeywords(renderRequest(item));
  return { id: item.id, set, truth: item.category, predicted: k.category, attempts: MAX_ATTEMPTS, schemaValidFirstTry: false, fallback: true, latencyMs: performance.now() - t0, errors };
}

async function runAll(provider: LlmProvider, concurrency: number): Promise<ItemResult[]> {
  const queue = Object.entries(sets).flatMap(([set, items]) => items.map((item) => ({ set, item })));
  const out: ItemResult[] = [];
  let next = 0;
  let done = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      const job = queue[i];
      if (!job) return;
      out[i] = await classifyItem(provider, job.item, job.set);
      done++;
      if (done % 20 === 0) console.log(`${done} / ${queue.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return out;
}

function report(results: ItemResult[]) {
  const truth = results.map((r) => r.truth);
  const pred = results.map((r) => r.predicted);
  const per = perClass(CATEGORIES, truth, pred);
  const latencies = results.map((r) => r.latencyMs);
  return {
    n: results.length,
    accuracy: round(accuracy(truth, pred)),
    macroF1: round(macroF1(CATEGORIES, truth, pred)),
    perClass: Object.fromEntries(Object.entries(per).map(([k, v]) => [k, { precision: round(v.precision), recall: round(v.recall), f1: round(v.f1), support: v.support }])),
    confusion: { labels: [...CATEGORIES], rowsAreTruth: true, matrix: confusionMatrix(CATEGORIES, truth, pred) },
    schemaValidFirstTry: round(results.filter((r) => r.schemaValidFirstTry).length / results.length),
    retryRate: round(results.filter((r) => r.attempts > 1).length / results.length),
    fallbackRate: round(results.filter((r) => r.fallback).length / results.length),
    latencyMs: { p50: round(percentile(latencies, 50), 1), p95: round(percentile(latencies, 95), 1) },
  };
}

function keywordBaseline() {
  const out: Record<string, unknown> = {};
  for (const [set, items] of Object.entries(sets)) {
    const truth = items.map((i) => i.category);
    const pred = items.map((i) => classifyByKeywords(renderRequest(i)).category);
    out[set] = { n: items.length, accuracy: round(accuracy(truth, pred)), macroF1: round(macroF1(CATEGORIES, truth, pred)) };
  }
  return out;
}

// ---------- main ----------

const meta = runMeta({ seed: SEED, input: allItems, extra: { command: `node scripts/eval-triage.ts ${process.argv.slice(2).join(" ")}`, provider: args.provider, set: args.set } });
let provider: LlmProvider;
let llm: Awaited<ReturnType<typeof preflight>> | null = null;
let concurrency = 4;
if (args.provider === "openai-compat") {
  const p = new OpenAiCompatProvider(String(args["base-url"]), String(args.model));
  llm = await preflight(p);
  concurrency = llm.totalSlots;
  provider = p;
  console.log(`pre-flight ok: ${allItems.length} prompts, max ${llm.maxPromptTokens} tokens, n_ctx ${llm.nCtxPerSlot}, ${llm.totalSlots} slot(s)`);
} else if (args.provider === "stub") {
  provider = new StubProvider();
} else {
  throw new Error("--provider must be openai-compat or stub (Workers AI does not run locally)");
}

let results: ItemResult[];
let contextOverflow: string | null = null;
try {
  results = await runAll(provider, concurrency);
} catch (err) {
  if (!(err instanceof ContextOverflowError)) throw err;
  contextOverflow = err.message;
  results = [];
}

const bySet: Record<string, unknown> = {};
for (const set of Object.keys(sets)) bySet[set] = report(results.filter((r) => r.set === set));

const result = {
  meta: { ...meta, llm },
  provider: { id: provider.id, model: provider.model, label: provider.id === "stub" ? "Keyword stub (keyword-v1), not an LLM" : `${provider.model} via ${String(args["base-url"])}` },
  notes: [
    "Few-shot examples come from a template pool disjoint from both eval sets (SPEC 10.2).",
    "The templated set is generated from the eval template pool; the hard set was authored during the build with AI assistance and labeled per evals/triage-labeling-guide.md.",
    "Each item gets up to 3 attempts, then the keyword fallback, as in the Workflow.",
  ],
  sets: bySet,
  keywordBaseline: keywordBaseline(),
  contextOverflow,
  items: results.map((r) => ({ id: r.id, set: r.set, truth: r.truth, predicted: r.predicted, attempts: r.attempts, fallback: r.fallback, errors: r.errors })),
};

const outPath = String(args.out ?? (args.provider === "stub" ? "evals/results/triage-keyword.json" : `evals/results/triage-${args.model}.json`));
const out = path.isAbsolute(outPath) ? outPath : path.join(ROOT, outPath);
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ provider: result.provider, sets: Object.fromEntries(Object.entries(bySet).map(([k, v]) => [k, { accuracy: (v as { accuracy: number }).accuracy, macroF1: (v as { macroF1: number }).macroF1, fallbackRate: (v as { fallbackRate: number }).fallbackRate }])), keywordBaseline: result.keywordBaseline }, null, 2));
console.log(`wrote ${path.relative(ROOT, out)}${meta.dirty ? " (dirty tree: npm run results will refuse it)" : ""}`);
if (contextOverflow) {
  console.error(`context overflow during the run: ${contextOverflow}`);
  process.exit(4);
}
