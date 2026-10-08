// Facilities request generators. Both draw only from the "eval" template pool.
import { type Rng, intBetween, mulberry32, pick, shuffle } from "../rng.ts";
import { CATEGORIES, type Category } from "../triage/categories.ts";
import { employeeId } from "./employees.ts";
import { EVAL_TEMPLATES, type RequestTemplate } from "./request-templates.ts";
import { generateResources } from "./resources.ts";

export interface GeneratedRequest {
  title: string;
  description: string;
  locationNote: string;
  resourceId: string | null;
  templateId: string;
  category: Category;
}

export interface LabeledRequest extends GeneratedRequest {
  id: string;
}

export type SeedRequestStatus = "awaiting_review" | "assigned" | "in_progress" | "resolved" | "cancelled";

export interface SeedRequest extends GeneratedRequest {
  id: string;
  reporterId: string;
  status: SeedRequestStatus;
  /** Minutes before the seed time; the seed route turns this into timestamps. */
  ageMinutes: number;
  /** Staff member who reviewed it, for statuses past awaiting_review. */
  reviewerId: string | null;
}

const OPENERS = ["Heads up:", "Since this morning", "Just noticed that", "For the last two days", "Reporting that"];
const CLOSERS = [
  "Could someone take a look?",
  "It is affecting a few of us nearby.",
  "Thanks in advance.",
  "Happy to show anyone where it is.",
  "Not urgent, but it is getting worse.",
];
const PLACES = ["by the second floor kitchen", "outside the third floor restrooms", "near the main elevators", "in the north stairwell lobby"];

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function render(rng: Rng, template: RequestTemplate): GeneratedRequest {
  const subject = pick(rng, template.subjects);
  const symptom = pick(rng, template.symptoms);
  const resources = generateResources();
  let location: string;
  let locationNote: string;
  let resourceId: string | null = null;
  if (rng() < 0.6) {
    const r = pick(rng, resources);
    resourceId = r.id;
    location = r.kind === "desk" ? `near ${r.name}` : `in ${r.name}`;
    locationNote = r.kind === "desk" ? `Near ${r.name}` : `${r.name} meeting room`;
  } else {
    location = pick(rng, PLACES);
    locationNote = capitalize(location);
  }
  const title = rng() < 0.5 ? `${capitalize(subject)} ${symptom}` : `${capitalize(subject)} ${location}`;
  const opener = pick(rng, OPENERS);
  const closer = pick(rng, CLOSERS);
  const description = `${opener} the ${subject} ${location} ${symptom}. ${closer}`;
  return { title: title.slice(0, 120), description, locationNote, resourceId, templateId: template.id, category: template.category };
}

function templatesFor(category: Category): RequestTemplate[] {
  return EVAL_TEMPLATES.filter((t) => t.category === category);
}

/** Exactly 200 labeled items (50 per category) for the triage eval, eval pool only. */
export function generateLabeledRequests(seed: number): LabeledRequest[] {
  const rng = mulberry32(seed ^ 0x7a1a6e);
  const items: GeneratedRequest[] = [];
  for (const category of CATEGORIES) {
    const pool = templatesFor(category);
    for (let i = 0; i < 50; i++) items.push(render(rng, pool[i % pool.length] as RequestTemplate));
  }
  return shuffle(rng, items).map((it, i) => ({ id: `tri_${String(i + 1).padStart(3, "0")}`, ...it }));
}

const SEED_STATUSES: readonly SeedRequestStatus[] = [
  "awaiting_review",
  "awaiting_review",
  "awaiting_review",
  "assigned",
  "assigned",
  "in_progress",
  "in_progress",
  "resolved",
  "resolved",
  "cancelled",
];

/** Exactly 40 demo requests (10 per category, mixed statuses) for the dashboards. */
export function generateSeedRequests(seed: number): SeedRequest[] {
  const rng = mulberry32(seed ^ 0x5eed);
  const items: SeedRequest[] = [];
  for (const category of CATEGORIES) {
    const pool = templatesFor(category);
    for (let i = 0; i < 10; i++) {
      const base = render(rng, pool[i % pool.length] as RequestTemplate);
      const status = SEED_STATUSES[i] as SeedRequestStatus;
      const reviewed = status === "assigned" || status === "in_progress" || status === "resolved";
      items.push({
        ...base,
        id: "",
        reporterId: employeeId(intBetween(rng, 1, 92)),
        status,
        ageMinutes: intBetween(rng, 45, 14 * 24 * 60),
        reviewerId: reviewed ? employeeId(intBetween(rng, 93, 98)) : null,
      });
    }
  }
  return shuffle(rng, items).map((it, i) => ({ ...it, id: `req_seed_${String(i + 1).padStart(3, "0")}` }));
}
