// Facilities request templates in two disjoint pools (SPEC 10.2, m17):
// - "eval": the only pool the generators draw from (seed requests, the 200-item eval set).
// - "fewshot": rendered into the classifier prompt as examples, never used to generate data.
// A test asserts the pools share no template id, no subject phrase and no symptom phrase,
// and that no phrase from one pool appears inside the other pool's text.
import type { Category } from "../triage/categories.ts";

export interface RequestTemplate {
  id: string;
  pool: "eval" | "fewshot";
  category: Category;
  /** Each subject reads naturally with each symptom: "The <subject> <symptom>." */
  subjects: readonly string[];
  symptoms: readonly string[];
}

export const EVAL_TEMPLATES: readonly RequestTemplate[] = [
  // building_systems: heating, cooling, ventilation, air quality, plumbing, leaks, water
  {
    id: "ev-bs-temperature",
    pool: "eval",
    category: "building_systems",
    subjects: ["air conditioning", "heating", "thermostat"],
    symptoms: ["is blowing warm air all afternoon", "will not switch off", "keeps the area far too cold"],
  },
  {
    id: "ev-bs-ventilation",
    pool: "eval",
    category: "building_systems",
    subjects: ["air vent", "ventilation fan", "return air grille"],
    symptoms: ["is making a loud rattling noise", "has stopped moving any air", "smells musty whenever it runs"],
  },
  {
    id: "ev-bs-plumbing",
    pool: "eval",
    category: "building_systems",
    subjects: ["kitchen sink", "restroom faucet", "water fountain"],
    symptoms: ["is clogged and draining slowly", "keeps running after it is turned off", "has almost no water pressure"],
  },
  {
    id: "ev-bs-leak",
    pool: "eval",
    category: "building_systems",
    subjects: ["ceiling tile", "pipe under the counter", "window frame"],
    symptoms: ["is dripping water onto the floor", "has a growing water stain", "leaks whenever it rains"],
  },
  // electrical_av: power, outlets, lighting, displays, projectors, conferencing and AV gear
  {
    id: "ev-ea-power",
    pool: "eval",
    category: "electrical_av",
    subjects: ["power outlet", "floor power box", "desk power strip"],
    symptoms: ["has no power at all", "sparks when a charger is plugged in", "trips the breaker"],
  },
  {
    id: "ev-ea-lighting",
    pool: "eval",
    category: "electrical_av",
    subjects: ["overhead light", "ceiling light panel", "task lamp"],
    symptoms: ["flickers constantly", "is completely dark", "buzzes loudly"],
  },
  {
    id: "ev-ea-display",
    pool: "eval",
    category: "electrical_av",
    subjects: ["wall display", "projector", "external monitor"],
    symptoms: ["shows no signal from the HDMI cable", "keeps turning itself off", "has a flickering picture"],
  },
  {
    id: "ev-ea-conferencing",
    pool: "eval",
    category: "electrical_av",
    subjects: ["video conferencing camera", "room microphone", "conference speakerphone"],
    symptoms: ["is not detected by the room system", "cuts out during calls", "produces loud feedback"],
  },
  // furniture_fixtures: desks, chairs, doors, locks, whiteboards, blinds, shelving
  {
    id: "ev-ff-chair",
    pool: "eval",
    category: "furniture_fixtures",
    subjects: ["office chair", "chair armrest", "chair wheel"],
    symptoms: ["is broken and wobbles", "snapped off this morning", "is cracked and unsafe to use"],
  },
  {
    id: "ev-ff-desk",
    pool: "eval",
    category: "furniture_fixtures",
    subjects: ["standing desk frame", "desk drawer", "keyboard tray"],
    symptoms: ["is jammed and will not move", "came loose from its rail", "sags badly on one side"],
  },
  {
    id: "ev-ff-door",
    pool: "eval",
    category: "furniture_fixtures",
    subjects: ["meeting room door", "door handle", "cabinet lock"],
    symptoms: ["does not latch closed", "is stuck and hard to open", "squeaks every time it is used"],
  },
  {
    id: "ev-ff-fixture",
    pool: "eval",
    category: "furniture_fixtures",
    subjects: ["whiteboard", "window blind", "wall shelf"],
    symptoms: ["is pulling away from the wall", "has a broken mounting bracket", "is hanging crooked"],
  },
  // cleaning_safety: spills, trash, restroom supplies, pests, odors, trip hazards
  {
    id: "ev-cs-spill",
    pool: "eval",
    category: "cleaning_safety",
    subjects: ["coffee spill", "sticky soda spill", "yogurt spill"],
    symptoms: ["was left on the carpet", "is spreading across the walkway", "has been there since yesterday"],
  },
  {
    id: "ev-cs-trash",
    pool: "eval",
    category: "cleaning_safety",
    subjects: ["trash bin", "recycling bin", "compost bin"],
    symptoms: ["is overflowing", "has not been emptied for days", "gives off a bad odor"],
  },
  {
    id: "ev-cs-supplies",
    pool: "eval",
    category: "cleaning_safety",
    subjects: ["soap dispenser", "paper towel dispenser", "toilet paper holder"],
    symptoms: ["is empty", "ran out before lunch", "needs a refill"],
  },
  {
    id: "ev-cs-hazard",
    pool: "eval",
    category: "cleaning_safety",
    subjects: ["loose floor mat", "torn carpet seam", "cable running across the aisle"],
    symptoms: ["is a trip hazard", "caught someone's foot today", "has people stumbling"],
  },
  {
    id: "ev-cs-pests",
    pool: "eval",
    category: "cleaning_safety",
    subjects: ["line of ants", "cluster of fruit flies", "trail of mouse droppings"],
    symptoms: ["showed up near the snack shelf", "keeps coming back by the pantry", "was spotted under the counter"],
  },
];

/**
 * Few-shot examples: two per category, rendered into the prompt. Subjects and symptoms
 * share nothing with EVAL_TEMPLATES.
 */
export interface FewShotExample {
  template: RequestTemplate;
  title: string;
  description: string;
}

function fewshot(id: string, category: Category, subject: string, symptom: string, title: string, description: string): FewShotExample {
  return { template: { id, pool: "fewshot", category, subjects: [subject], symptoms: [symptom] }, title, description };
}

export const FEWSHOT_EXAMPLES: readonly FewShotExample[] = [
  fewshot(
    "fs-bs-radiator",
    "building_systems",
    "radiator",
    "is clanking and too hot to touch",
    "Radiator clanking by the lounge",
    "The radiator by the lounge is clanking and too hot to touch. The room feels stuffy too.",
  ),
  fewshot(
    "fs-bs-drain",
    "building_systems",
    "shower drain in the bike room",
    "is backing up",
    "Bike room shower drain backing up",
    "The shower drain in the bike room is backing up and grey water sits in the stall after each use.",
  ),
  fewshot(
    "fs-ea-tv",
    "electrical_av",
    "lobby television",
    "will not power on",
    "Lobby television dead",
    "The lobby television will not power on. The remote batteries were swapped and nothing changed.",
  ),
  fewshot(
    "fs-ea-usb",
    "electrical_av",
    "USB charging hub",
    "stopped charging laptops",
    "USB charging hub stopped working",
    "The USB charging hub on the hot desk bench stopped charging laptops; the indicator LED is off.",
  ),
  fewshot(
    "fs-ff-bookcase",
    "furniture_fixtures",
    "bookcase",
    "is leaning and unstable",
    "Bookcase leaning in the library corner",
    "The tall bookcase in the library corner is leaning and unstable. It moves when a book is pulled out.",
  ),
  fewshot(
    "fs-ff-hook",
    "furniture_fixtures",
    "coat hook",
    "has snapped off",
    "Coat hook broke off",
    "A coat hook near the entrance has snapped off, leaving the screws sticking out of the panel.",
  ),
  fewshot(
    "fs-cs-glass",
    "cleaning_safety",
    "broken glass",
    "is scattered on the break room floor",
    "Broken glass in the break room",
    "Someone dropped a jar and broken glass is scattered on the break room floor near the fridge.",
  ),
  fewshot(
    "fs-cs-sanitizer",
    "cleaning_safety",
    "hand sanitizer station",
    "needs restocking",
    "Hand sanitizer station by reception",
    "The hand sanitizer station by reception needs restocking; it has been dry for two days.",
  ),
];

export const FEWSHOT_TEMPLATES: readonly RequestTemplate[] = FEWSHOT_EXAMPLES.map((e) => e.template);
