// Guards the CI workflow's supply chain and runner image (PROGRESS "Open items"):
// every third-party action is pinned to a full commit SHA with its release tag in a
// trailing comment, and every job names an explicit runner image instead of a moving
// "-latest" label.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const dir = path.join(import.meta.dirname, "..", "..", ".github", "workflows");
const workflows = readdirSync(dir)
  .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
  .map((f) => ({ file: f, text: readFileSync(path.join(dir, f), "utf8") }));

describe("CI workflows", () => {
  it("exist", () => {
    expect(workflows.length).toBeGreaterThan(0);
  });

  it("pin every action to a full commit SHA with the version tag in a comment", () => {
    const uses = workflows.flatMap(({ file, text }) =>
      text
        .split("\n")
        .filter((l) => /^\s*(-\s+)?uses:/.test(l))
        .map((l) => ({ file, line: l.trim() })),
    );
    expect(uses.length).toBeGreaterThan(0);
    for (const { file, line } of uses) {
      expect(`${file}: ${line}`).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    }
  });

  it("run every job on an explicit Ubuntu 24.04 image, not a moving -latest label", () => {
    const runsOn = workflows.flatMap(({ file, text }) =>
      text
        .split("\n")
        .filter((l) => /^\s*runs-on:/.test(l))
        .map((l) => ({ file, value: l.split(":")[1]?.trim() })),
    );
    expect(runsOn.length).toBeGreaterThan(0);
    for (const { file, value } of runsOn) expect(`${file}: ${value}`).toBe(`${file}: ubuntu-24.04`);
  });
});
