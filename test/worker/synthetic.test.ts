import { describe, expect, it } from "vitest";
import {
  DEPARTMENT_COUNTS,
  generateEmployees,
} from "../../src/shared/synthetic/employees.ts";
import { SEED, generateLabeledRequests, generateResources, generateSeedRequests } from "../../src/shared/synthetic/index.ts";
import { EVAL_TEMPLATES, FEWSHOT_EXAMPLES, FEWSHOT_TEMPLATES } from "../../src/shared/synthetic/request-templates.ts";
import { CATEGORIES } from "../../src/shared/triage/categories.ts";
import { generatorHashes } from "../helpers/generator-hashes.ts";
import { PINNED_HASHES } from "../helpers/pins.ts";

const countBy = <T,>(items: readonly T[], key: (t: T) => string) => {
  const m: Record<string, number> = {};
  for (const it of items) m[key(it)] = (m[key(it)] ?? 0) + 1;
  return m;
};

describe("employees (SPEC 11.1)", () => {
  const employees = generateEmployees(SEED);

  it("has exactly 100 with ids emp_001..emp_100", () => {
    expect(employees).toHaveLength(100);
    expect(employees.map((e) => e.id)).toEqual(Array.from({ length: 100 }, (_, i) => `emp_${String(i + 1).padStart(3, "0")}`));
  });

  it("splits roles 92 / 6 / 2 by id range", () => {
    expect(countBy(employees, (e) => e.role)).toEqual({ employee: 92, facilities_staff: 6, facilities_admin: 2 });
    expect(employees.slice(0, 92).every((e) => e.role === "employee")).toBe(true);
    expect(employees.slice(92, 98).every((e) => e.role === "facilities_staff")).toBe(true);
    expect(employees.slice(98).every((e) => e.role === "facilities_admin")).toBe(true);
  });

  it("has the department split for employees and Facilities for staff and admins", () => {
    const depts = countBy(employees.slice(0, 92), (e) => e.department);
    expect(depts).toEqual(Object.fromEntries(DEPARTMENT_COUNTS));
    expect(employees.slice(92).every((e) => e.department === "Facilities")).toBe(true);
  });

  it("has unique emails on the reserved .test TLD", () => {
    const emails = employees.map((e) => e.email);
    expect(new Set(emails.map((e) => e.toLowerCase())).size).toBe(100);
    for (const e of emails) expect(e).toMatch(/^[a-z]+\.[a-z]+\d*@placessync\.test$/);
  });
});

describe("resources (SPEC 11.2)", () => {
  const resources = generateResources();

  it("has exactly 20: 14 desks and 6 rooms", () => {
    expect(resources).toHaveLength(20);
    expect(countBy(resources, (r) => r.kind)).toEqual({ desk: 14, room: 6 });
    expect(new Set(resources.map((r) => r.id)).size).toBe(20);
  });

  it("matches the fixed table", () => {
    const byId = Object.fromEntries(resources.map((r) => [r.id, r]));
    expect(byId.res_2a01).toMatchObject({ name: "Desk 2A-01", floor: 2, zone: "North", capacity: 1, amenities: ["monitor", "standing_desk", "window"] });
    expect(byId.res_2a04?.amenities).toEqual(["monitor"]);
    expect(byId.res_2b02?.amenities).toEqual(["docking_station", "dual_monitor"]);
    expect(byId.res_3a01?.amenities).toEqual(["monitor", "window"]);
    expect(byId.res_3b02?.amenities).toEqual(["monitor", "standing_desk"]);
    const rooms = resources.filter((r) => r.kind === "room").map((r) => [r.id, r.floor, r.zone, r.capacity, r.amenities.join(",")]);
    expect(rooms).toEqual([
      ["res_redwood", 2, "North", 4, "display,video_conf"],
      ["res_sequoia", 2, "South", 8, "display,video_conf,whiteboard"],
      ["res_cypress", 2, "South", 2, "phone_booth"],
      ["res_juniper", 3, "North", 6, "display,whiteboard"],
      ["res_alder", 3, "South", 10, "display,video_conf,whiteboard"],
      ["res_madrone", 3, "South", 12, "display,video_conf"],
    ]);
  });
});

describe("request template pools (SPEC 10.2)", () => {
  const evalPhrases = EVAL_TEMPLATES.flatMap((t) => [...t.subjects, ...t.symptoms]);
  const fewshotPhrases = FEWSHOT_TEMPLATES.flatMap((t) => [...t.subjects, ...t.symptoms]);

  it("share no template id", () => {
    const evalIds = new Set(EVAL_TEMPLATES.map((t) => t.id));
    for (const t of FEWSHOT_TEMPLATES) expect(evalIds.has(t.id)).toBe(false);
  });

  it("share no subject and no symptom phrase", () => {
    const evalSubjects = new Set(EVAL_TEMPLATES.flatMap((t) => t.subjects).map((s) => s.toLowerCase()));
    const evalSymptoms = new Set(EVAL_TEMPLATES.flatMap((t) => t.symptoms).map((s) => s.toLowerCase()));
    for (const t of FEWSHOT_TEMPLATES) {
      for (const s of t.subjects) expect(evalSubjects.has(s.toLowerCase())).toBe(false);
      for (const s of t.symptoms) expect(evalSymptoms.has(s.toLowerCase())).toBe(false);
    }
  });

  it("no eval phrase appears inside few-shot text, and no few-shot phrase inside generated text", () => {
    const fewshotText = FEWSHOT_EXAMPLES.map((e) => `${e.title}\n${e.description}`.toLowerCase());
    for (const p of evalPhrases) for (const t of fewshotText) expect(t).not.toContain(p.toLowerCase());
    const generated = [...generateLabeledRequests(SEED), ...generateSeedRequests(SEED)].map((r) =>
      `${r.title}\n${r.description}`.toLowerCase(),
    );
    for (const p of fewshotPhrases) for (const t of generated) expect(t).not.toContain(p.toLowerCase());
  });

  it("has two few-shot examples per category", () => {
    expect(countBy(FEWSHOT_TEMPLATES, (t) => t.category)).toEqual(Object.fromEntries(CATEGORIES.map((c) => [c, 2])));
  });
});

describe("request generators (SPEC 11.1)", () => {
  it("labeled eval set: exactly 200, 50 per category, eval pool only, valid lengths", () => {
    const items = generateLabeledRequests(SEED);
    expect(items).toHaveLength(200);
    expect(countBy(items, (i) => i.category)).toEqual(Object.fromEntries(CATEGORIES.map((c) => [c, 50])));
    const evalIds = new Set(EVAL_TEMPLATES.map((t) => t.id));
    for (const it of items) {
      expect(evalIds.has(it.templateId)).toBe(true);
      expect(it.title.length).toBeGreaterThanOrEqual(5);
      expect(it.title.length).toBeLessThanOrEqual(120);
      expect(it.description.length).toBeGreaterThanOrEqual(20);
      expect(it.description.length).toBeLessThanOrEqual(2000);
    }
  });

  it("seed requests: exactly 40, 10 per category, mixed statuses, reporters are employees", () => {
    const items = generateSeedRequests(SEED);
    expect(items).toHaveLength(40);
    expect(countBy(items, (i) => i.category)).toEqual(Object.fromEntries(CATEGORIES.map((c) => [c, 10])));
    expect(new Set(items.map((i) => i.status)).size).toBe(5);
    for (const it of items) {
      expect(Number(it.reporterId.slice(4))).toBeLessThanOrEqual(92);
      if (it.reviewerId) expect(Number(it.reviewerId.slice(4))).toBeGreaterThanOrEqual(93);
    }
  });
});

describe("determinism (SPEC 11)", () => {
  it("same seed gives the pinned SHA-256 for every generator", async () => {
    expect(await generatorHashes(SEED)).toEqual(PINNED_HASHES);
  });

  it("a different seed gives different output", async () => {
    const other = await generatorHashes(SEED + 1);
    expect(other.employees).not.toBe(PINNED_HASHES.employees);
    expect(other.labeledRequests).not.toBe(PINNED_HASHES.labeledRequests);
    expect(other.seedRequests).not.toBe(PINNED_HASHES.seedRequests);
  });
});
