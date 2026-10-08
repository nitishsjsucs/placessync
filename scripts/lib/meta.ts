// The meta block every results file carries (SPEC 13): git SHA, dirty flag, timestamp,
// Node and wrangler versions, OS and CPU, seed and input hash. render-results refuses
// any file with dirty = true or a SHA that is not an ancestor of HEAD.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const ROOT = path.join(import.meta.dirname, "..", "..");

export interface RunMeta {
  gitSha: string;
  dirty: boolean;
  timestamp: string;
  node: string;
  wrangler: string;
  os: string;
  cpu: string;
  seed: number | null;
  inputSha256: string | null;
  [extra: string]: unknown;
}

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Tracked changes that make a run "dirty": anything except result files under evals/results/. */
export function dirtyPaths(porcelain: string): string[] {
  return porcelain
    .split("\n")
    .filter((l) => l.trim().length > 0)
    .map((l) => l.slice(3).trim())
    .filter((p) => !p.startsWith("evals/results/"));
}

/**
 * Call at the start of a run, before writing anything. Untracked files do not count as
 * dirty, and neither do changes under evals/results/ (an earlier eval in the same session
 * rewriting its own result file does not change the code being measured).
 */
export function runMeta(opts: { seed?: number; input?: unknown; extra?: Record<string, unknown> } = {}): RunMeta {
  const wrangler = (JSON.parse(readFileSync(path.join(ROOT, "node_modules", "wrangler", "package.json"), "utf8")) as { version: string }).version;
  return {
    gitSha: git(["rev-parse", "HEAD"]),
    dirty: dirtyPaths(git(["status", "--porcelain", "--untracked-files=no"])).length > 0,
    timestamp: new Date().toISOString(),
    node: process.version,
    wrangler,
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    seed: opts.seed ?? null,
    inputSha256: opts.input === undefined ? null : sha256(JSON.stringify(opts.input)),
    ...opts.extra,
  };
}
