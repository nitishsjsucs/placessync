// Metrics for the evals (SPEC 13): accuracy, per-class precision/recall/F1, macro-F1,
// confusion matrix, percentiles. Tested in test/node/eval-math.test.ts.

export function accuracy(truth: readonly string[], pred: readonly string[]): number {
  if (truth.length !== pred.length) throw new Error("length mismatch");
  if (truth.length === 0) return 0;
  let ok = 0;
  for (let i = 0; i < truth.length; i++) if (truth[i] === pred[i]) ok++;
  return ok / truth.length;
}

/** matrix[t][p] = count of items with true label t predicted as p, in the given label order. */
export function confusionMatrix(labels: readonly string[], truth: readonly string[], pred: readonly string[]): number[][] {
  const index = new Map(labels.map((l, i) => [l, i]));
  const m = labels.map(() => labels.map(() => 0));
  for (let i = 0; i < truth.length; i++) {
    const t = index.get(truth[i] as string);
    const p = index.get(pred[i] as string);
    if (t === undefined || p === undefined) throw new Error(`label outside the set: ${truth[i]} / ${pred[i]}`);
    (m[t] as number[])[p] = ((m[t] as number[])[p] ?? 0) + 1;
  }
  return m;
}

export interface ClassScores {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export function perClass(labels: readonly string[], truth: readonly string[], pred: readonly string[]): Record<string, ClassScores> {
  const m = confusionMatrix(labels, truth, pred);
  const out: Record<string, ClassScores> = {};
  labels.forEach((label, i) => {
    const tp = (m[i] as number[])[i] ?? 0;
    const predicted = m.reduce((s, row) => s + (row[i] ?? 0), 0);
    const actual = (m[i] as number[]).reduce((s, v) => s + v, 0);
    const precision = predicted === 0 ? 0 : tp / predicted;
    const recall = actual === 0 ? 0 : tp / actual;
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    out[label] = { precision, recall, f1, support: actual };
  });
  return out;
}

export function macroF1(labels: readonly string[], truth: readonly string[], pred: readonly string[]): number {
  const scores = perClass(labels, truth, pred);
  return labels.reduce((s, l) => s + (scores[l]?.f1 ?? 0), 0) / labels.length;
}

/** Linear-interpolated percentile (p in 0..100) of the values; null for an empty list. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const a = sorted[lo] as number;
  const b = sorted[hi] as number;
  return a + (b - a) * (rank - lo);
}

export function round(n: number | null, digits = 4): number | null {
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
