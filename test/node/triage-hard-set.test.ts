import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FEWSHOT_EXAMPLES } from "../../src/shared/synthetic/request-templates.ts";
import { CATEGORIES } from "../../src/shared/triage/categories.ts";

const items = readFileSync(path.join(import.meta.dirname, "..", "..", "evals", "data", "triage-hard.jsonl"), "utf8")
  .split("\n")
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l) as { id: string; category: string; title: string; description: string; rationale: string });

describe("evals/data/triage-hard.jsonl (SPEC 11.1)", () => {
  it("has exactly 40 items, 10 per category, unique ids, each with a labeling rationale", () => {
    expect(items).toHaveLength(40);
    expect(new Set(items.map((i) => i.id)).size).toBe(40);
    for (const c of CATEGORIES) expect(items.filter((i) => i.category === c)).toHaveLength(10);
    for (const i of items) expect(i.rationale.length).toBeGreaterThan(0);
  });

  it("fits the request API limits", () => {
    for (const i of items) {
      expect(i.title.length).toBeGreaterThanOrEqual(5);
      expect(i.title.length).toBeLessThanOrEqual(120);
      expect(i.description.length).toBeGreaterThanOrEqual(20);
      expect(i.description.length).toBeLessThanOrEqual(2000);
    }
  });

  it("shares no text with the few-shot examples", () => {
    const texts = new Set(items.flatMap((i) => [i.title, i.description]));
    for (const ex of FEWSHOT_EXAMPLES) {
      expect(texts.has(ex.title)).toBe(false);
      expect(texts.has(ex.description)).toBe(false);
    }
  });
});
