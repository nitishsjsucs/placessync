// The admin's "kept or changed" matrices (VIZ-09): for one provider, which suggested
// categories staff kept and which they changed, and into what. Providers are never
// combined (SPEC 6.1). Pure, so the shares, bins and headline are tested on their own.
import { CATEGORIES, type Category } from "../../shared/triage/categories.ts";

export interface KeptCell {
  provider: string;
  suggested: string;
  final: string;
  n: number;
}

export interface MatrixRow {
  suggested: Category;
  /** Count per final category, in CATEGORIES order. */
  counts: number[];
  total: number;
  kept: number;
}

export interface Matrix {
  provider: string;
  rows: MatrixRow[];
  reviewed: number;
  kept: number;
}

/** Short column and row headers; the full names go in abbr titles. */
export const SHORT_CATEGORY: Record<Category, string> = {
  building_systems: "Building",
  electrical_av: "Electrical",
  furniture_fixtures: "Furniture",
  cleaning_safety: "Cleaning",
};

/** Shorter still, for a phone, so a matrix fits 375 px without scrolling. */
export const TINY_CATEGORY: Record<Category, string> = {
  building_systems: "Bldg",
  electrical_av: "Elec",
  furniture_fixtures: "Furn",
  cleaning_safety: "Clean",
};

/** One matrix per provider, in the order given; rows only for suggested categories that have reviews. */
export function matrices(cells: readonly KeptCell[], providers?: readonly string[]): Matrix[] {
  const order = providers ?? [...new Set(cells.map((c) => c.provider))].sort();
  return order
    .map((provider) => {
      const mine = cells.filter((c) => c.provider === provider);
      const rows = CATEGORIES.map((suggested) => {
        const counts = CATEGORIES.map((final) => mine.filter((c) => c.suggested === suggested && c.final === final).reduce((n, c) => n + c.n, 0));
        const total = counts.reduce((a, b) => a + b, 0);
        return { suggested, counts, total, kept: counts[CATEGORIES.indexOf(suggested)] as number };
      }).filter((r) => r.total > 0);
      return { provider, rows, reviewed: rows.reduce((n, r) => n + r.total, 0), kept: rows.reduce((n, r) => n + r.kept, 0) };
    })
    .filter((m) => m.reviewed > 0);
}

/** The ramp step for a share of its row: 0 for none, then 1 to 5 in fifths. */
export function shareBin(n: number, total: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (n <= 0 || total <= 0) return 0;
  return Math.min(5, Math.max(1, Math.ceil((n / total) * 5))) as 1 | 2 | 3 | 4 | 5;
}

/** The largest changed pair, ties broken by category order (rows, then columns). */
export function mostChanged(m: Matrix): { from: Category; to: Category; n: number } | null {
  let best: { from: Category; to: Category; n: number } | null = null;
  for (const row of m.rows) {
    row.counts.forEach((n, i) => {
      const to = CATEGORIES[i] as Category;
      if (to === row.suggested || n === 0) return;
      if (!best || n > best.n) best = { from: row.suggested, to, n };
    });
  }
  return best;
}
