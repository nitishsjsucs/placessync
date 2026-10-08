// Keyword baseline and fallback classifier. Deterministic, offline, and always returns
// one of the four categories. The vocabulary follows the category scopes in SPEC 10.1.
import { CATEGORIES, type Category } from "./categories.ts";

const KEYWORDS: Record<Category, readonly string[]> = {
  building_systems: [
    "heat", "heating", "heater", "hvac", "air conditioning", "ac", "cooling", "too cold", "too hot", "temperature",
    "thermostat", "ventilation", "vent", "airflow", "air quality", "stuffy", "humid", "humidity", "plumbing", "pipe",
    "leak", "leaking", "leaks", "drip", "dripping", "water", "sink", "faucet", "toilet", "drain", "clogged", "flood",
    "radiator", "boiler", "fountain", "pressure",
  ],
  electrical_av: [
    "power", "outlet", "socket", "electrical", "electric", "breaker", "spark", "sparks", "light", "lights", "lighting",
    "bulb", "lamp", "flicker", "flickers", "flickering", "display", "screen", "monitor", "projector", "tv", "television",
    "hdmi", "camera", "microphone", "mic", "speaker", "speakerphone", "audio", "video", "conferencing", "av", "charger",
    "charging", "usb", "signal",
  ],
  furniture_fixtures: [
    "desk", "chair", "table", "door", "lock", "handle", "hinge", "latch", "whiteboard", "blind", "blinds", "shade",
    "shelf", "shelving", "cabinet", "drawer", "armrest", "wheel", "furniture", "bookcase", "hook", "keyboard tray",
    "wobbles", "wobbly", "bracket", "squeaks",
  ],
  cleaning_safety: [
    "spill", "spilled", "trash", "garbage", "bin", "recycling", "compost", "overflowing", "dirty", "cleaning", "mess",
    "soap", "paper towel", "toilet paper", "sanitizer", "refill", "restock", "empty", "pest", "pests", "ants", "mice",
    "mouse", "rodent", "flies", "cockroach", "odor", "smell", "smells", "trip", "hazard", "slippery", "broken glass",
    "glass", "droppings", "stumbling",
  ],
};

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const PATTERNS: { category: Category; keyword: string; re: RegExp; weight: number }[] = CATEGORIES.flatMap((category) =>
  KEYWORDS[category].map((keyword) => ({
    category,
    keyword,
    re: new RegExp(`\\b${escape(keyword)}\\b`, "gi"),
    weight: keyword.includes(" ") ? 2 : 1,
  })),
);

export interface KeywordResult {
  category: Category;
  confidence: number;
  rationale: string;
  scores: Record<Category, number>;
}

export function classifyByKeywords(text: string): KeywordResult {
  const scores = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<Category, number>;
  const hits: Record<Category, string[]> = { building_systems: [], electrical_av: [], furniture_fixtures: [], cleaning_safety: [] };
  for (const p of PATTERNS) {
    const n = text.match(p.re)?.length ?? 0;
    if (n > 0) {
      scores[p.category] += n * p.weight;
      hits[p.category].push(p.keyword);
    }
  }
  let best: Category = CATEGORIES[0];
  for (const c of CATEGORIES) if (scores[c] > scores[best]) best = c;
  const total = CATEGORIES.reduce((s, c) => s + scores[c], 0);
  if (total === 0) {
    return { category: best, confidence: 0.25, rationale: "No category keywords matched; defaulted to the first category.", scores };
  }
  const confidence = Math.round((scores[best] / total) * 100) / 100;
  const rationale = `Keyword match: ${hits[best].slice(0, 6).join(", ")}.`.slice(0, 160);
  return { category: best, confidence, rationale, scores };
}
