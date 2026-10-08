import { describe, expect, it } from "vitest";
import { accuracy, confusionMatrix, macroF1, perClass, percentile } from "../../scripts/lib/eval-math.ts";

const L = ["a", "b", "c"];
const truth = ["a", "a", "a", "b", "b", "c"];
const pred = ["a", "a", "b", "b", "c", "c"];

describe("eval math", () => {
  it("accuracy", () => {
    expect(accuracy(truth, pred)).toBeCloseTo(4 / 6, 10);
    expect(accuracy([], [])).toBe(0);
    expect(() => accuracy(["a"], [])).toThrow();
  });

  it("confusion matrix rows are truth, columns are predictions", () => {
    expect(confusionMatrix(L, truth, pred)).toEqual([
      [2, 1, 0],
      [0, 1, 1],
      [0, 0, 1],
    ]);
    expect(() => confusionMatrix(L, ["z"], ["a"])).toThrow();
  });

  it("per-class precision, recall and F1", () => {
    const s = perClass(L, truth, pred);
    expect(s.a).toEqual({ precision: 1, recall: 2 / 3, f1: 0.8, support: 3 });
    expect(s.b?.precision).toBeCloseTo(0.5, 10);
    expect(s.b?.recall).toBeCloseTo(0.5, 10);
    expect(s.b?.f1).toBeCloseTo(0.5, 10);
    expect(s.c?.precision).toBeCloseTo(0.5, 10);
    expect(s.c?.recall).toBe(1);
    expect(s.c?.f1).toBeCloseTo(2 / 3, 10);
  });

  it("macro-F1 averages the class F1 scores", () => {
    expect(macroF1(L, truth, pred)).toBeCloseTo((0.8 + 0.5 + 2 / 3) / 3, 10);
    expect(macroF1(L, ["a", "b"], ["a", "b"])).toBeCloseTo(2 / 3, 10);
  });

  it("percentiles interpolate linearly", () => {
    expect(percentile([], 50)).toBeNull();
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5);
    expect(percentile([10, 20, 30, 40, 50], 95)).toBeCloseTo(48, 10);
    expect(percentile([3, 1, 2], 0)).toBe(1);
    expect(percentile([3, 1, 2], 100)).toBe(3);
  });
});

describe("run meta dirty flag", () => {
  it("ignores result files but not code", async () => {
    const { dirtyPaths } = await import("../../scripts/lib/meta.ts");
    expect(dirtyPaths(" M evals/results/contention.json\n M evals/results/e2e.json\n")).toEqual([]);
    expect(dirtyPaths(" M scripts/eval-contention.ts\n M evals/results/e2e.json\n")).toEqual(["scripts/eval-contention.ts"]);
    expect(dirtyPaths("M  src/worker/app.ts\n")).toEqual(["src/worker/app.ts"]);
  });
});
