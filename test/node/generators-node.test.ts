import { describe, expect, it } from "vitest";
import { generatorHashes } from "../helpers/generator-hashes.ts";
import { PINNED_HASHES } from "../helpers/pins.ts";

// The generators run unchanged in Node (evals) and workerd (seed route, tests). Same
// pinned hashes in both runtimes (SPEC 12.3).
describe("generators under Node", () => {
  it("produce the same SHA-256 as in workerd", async () => {
    expect(process.versions.node).toBeTruthy();
    expect(await generatorHashes()).toEqual(PINNED_HASHES);
  });
});
