import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FEWSHOT_EXAMPLES } from "../../src/shared/synthetic/request-templates.ts";
import { CATEGORIES } from "../../src/shared/triage/categories.ts";
import { SYSTEM_PROMPT } from "../../src/shared/triage/prompt.ts";

type LabeledItem = { id: string; category: string; target?: string; technique?: string; title: string; description: string; rationale: string };
const load = (name: string) =>
  readFileSync(path.join(import.meta.dirname, "..", "..", "evals", "data", name), "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LabeledItem);
const items = load("triage-hard.jsonl");
const injection = load("triage-injection.jsonl");

const STOP = new Set(["the", "and", "from", "with", "that", "this", "into", "over", "under", "near", "keeps", "there", "when", "after", "about", "above", "below", "again", "still"]);
/** Content words of a title, cut to a 5-letter stem so "dripping" matches "drips". */
const stems = (text: string) => [...new Set(text.toLowerCase().match(/[a-z]+/g)?.filter((w) => w.length > 3 && !STOP.has(w)).map((w) => w.slice(0, 5)) ?? [])];

/**
 * Prompt lines that state a labeled item's case: a line holding at least three of the
 * item's title content words, or all of them when the title has fewer than three. This
 * is how "water dripping from a light fixture" in an earlier prompt matched hard_01
 * ("Water dripping out of a ceiling light").
 */
function promptLinesStating(item: LabeledItem): string[] {
  const words = stems(item.title);
  const need = Math.min(3, words.length);
  return SYSTEM_PROMPT.split("\n").filter((line) => {
    const have = new Set(stems(line));
    return words.filter((w) => have.has(w)).length >= need;
  });
}

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

  it("no item's case is spelled out in the system prompt", () => {
    for (const i of [...items, ...injection]) expect(promptLinesStating(i), i.id).toEqual([]);
  });

  it("the overlap check catches the worked example an earlier prompt held", () => {
    const hard01 = items.find((i) => i.id === "hard_01") as LabeledItem;
    const old = "Rules: pick the category of the underlying cause (water dripping from a light fixture is building_systems because the source is a leak).";
    const words = stems(hard01.title);
    const have = new Set(stems(old));
    expect(words.filter((w) => have.has(w)).length).toBeGreaterThanOrEqual(3);
  });
});

describe("evals/data/triage-injection.jsonl", () => {
  it("has 12 items, 3 per category, each forcing a different category with a named technique", () => {
    expect(injection).toHaveLength(12);
    expect(new Set(injection.map((i) => i.id)).size).toBe(12);
    for (const c of CATEGORIES) expect(injection.filter((i) => i.category === c)).toHaveLength(3);
    for (const i of injection) {
      expect(CATEGORIES).toContain(i.target);
      expect(i.target, i.id).not.toBe(i.category);
      expect(i.technique?.length, i.id).toBeGreaterThan(0);
      expect(i.rationale.length).toBeGreaterThan(0);
      // The forced category is named in the text itself.
      expect(`${i.title}\n${i.description}`, i.id).toContain(i.target as string);
      expect(i.title.length).toBeGreaterThanOrEqual(5);
      expect(i.title.length).toBeLessThanOrEqual(120);
      expect(i.description.length).toBeGreaterThanOrEqual(20);
      expect(i.description.length).toBeLessThanOrEqual(2000);
    }
  });

  it("shares no text with the few-shot examples or the hard set", () => {
    const texts = new Set([...items, ...FEWSHOT_EXAMPLES].flatMap((i) => [i.title, i.description]));
    for (const i of injection) {
      expect(texts.has(i.title)).toBe(false);
      expect(texts.has(i.description)).toBe(false);
    }
  });
});
