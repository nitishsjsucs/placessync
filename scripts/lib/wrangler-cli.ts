// Runs this repo's wrangler with its own OAuth login, pinned to the production account,
// and parses the JSON or text it prints. The runner is injectable so the doctor and setup
// logic is tested with recorded outputs.
import { spawn } from "node:child_process";
import path from "node:path";
import { ROOT } from "./meta.ts";
import { PROD } from "./prod-config.ts";

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type Runner = (args: string[], opts?: { inherit?: boolean }) => Promise<RunResult>;

const WRANGLER = path.join(ROOT, "node_modules", ".bin", "wrangler");

/**
 * Credentials wrangler would use instead of its OAuth login: the current names and the
 * deprecated CF_ aliases wrangler still reads (CF_API_TOKEN among them, which is where
 * this repo's scripts take the account API token from). None reaches a child process.
 */
export const WRANGLER_CREDENTIAL_VARS = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_EMAIL", "CF_API_TOKEN", "CF_API_KEY", "CF_EMAIL"] as const;

/**
 * The env every child process gets: the production account, no color, no prompts, and no
 * API credentials, so wrangler always uses its own OAuth login.
 */
export function childEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...base, CLOUDFLARE_ACCOUNT_ID: PROD.accountId, NO_COLOR: "1", FORCE_COLOR: "0", WRANGLER_SEND_METRICS: "false" };
  for (const name of WRANGLER_CREDENTIAL_VARS) delete env[name];
  return env;
}

/** Spawns a command in the repo root. With inherit, output streams to this terminal and is not captured. */
export function run(cmd: string, args: string[], opts: { inherit?: boolean } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: ROOT, env: childEnv(), stdio: opts.inherit ? ["ignore", "inherit", "inherit"] : ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export const wrangler: Runner = (args, opts) => run(WRANGLER, args, opts);

/** Arguments that point wrangler at the production environment of the source config. */
export const PROD_ENV_ARGS = ["--env", "production", "-c", "wrangler.jsonc"];

export function parseJsonOutput<T>(stdout: string): T {
  const text = stdout.trim();
  // wrangler can print a banner line before the JSON; start at the first [ or {.
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error("no JSON in wrangler output");
  return JSON.parse(text.slice(start)) as T;
}

export interface Whoami {
  loggedIn: boolean;
  email: string | null;
  accountIds: string[];
}

export function parseWhoami(r: RunResult): Whoami {
  if (r.code !== 0) return { loggedIn: false, email: null, accountIds: [] };
  const d = parseJsonOutput<{ loggedIn?: boolean; email?: string; accounts?: { id: string }[] }>(r.stdout);
  return { loggedIn: d.loggedIn === true, email: d.email ?? null, accountIds: (d.accounts ?? []).map((a) => a.id) };
}

export function findD1(r: RunResult, name: string): { uuid: string } | null {
  if (r.code !== 0) throw new Error(`wrangler d1 list failed: ${lastLine(r)}`);
  const list = parseJsonOutput<{ name: string; uuid: string }[]>(r.stdout);
  const hit = list.find((d) => d.name === name);
  return hit ? { uuid: hit.uuid } : null;
}

/** Unapplied migration file names from `wrangler d1 migrations list`. */
export function parsePendingMigrations(r: RunResult): string[] {
  const text = `${r.stdout}\n${r.stderr}`;
  if (r.code !== 0) throw new Error(`wrangler d1 migrations list failed: ${lastLine(r)}`);
  if (/No migrations to apply/i.test(text)) return [];
  const names = [...text.matchAll(/\b(\d{4}_[\w-]+\.sql)\b/g)].map((m) => m[1] as string);
  if (names.length === 0) throw new Error("could not read wrangler d1 migrations list output");
  return [...new Set(names)];
}

/** Rows of the first statement from `wrangler d1 execute --json`. */
export function parseExecuteRows<T>(r: RunResult): T[] {
  if (r.code !== 0) throw new Error(`wrangler d1 execute failed: ${lastLine(r)}`);
  const out = parseJsonOutput<{ results?: T[] }[]>(r.stdout);
  return out[0]?.results ?? [];
}

export function lastLine(r: RunResult): string {
  const lines = `${r.stderr}\n${r.stdout}`
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^[─⛅]/.test(l) && !l.includes("Logs were written"));
  return lines.find((l) => /✘|ERROR|error/i.test(l)) ?? lines.at(-1) ?? `exit ${r.code}`;
}
