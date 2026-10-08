import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(import.meta.dirname, "..", "..");
const workerDir = path.join(root, "src", "worker");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") ? [p] : [];
  });
}

// SPEC 7.5: every path to a Durable Object goes through ledgerFor's allowlist check.
describe("ledgerFor guard", () => {
  it("getByName( appears only in src/worker/ledger/ledger-for.ts", () => {
    const offenders = walk(workerDir)
      .filter((f) => readFileSync(f, "utf8").includes("getByName("))
      .map((f) => path.relative(root, f));
    expect(offenders).toEqual([path.join("src", "worker", "ledger", "ledger-for.ts")]);
  });
});
