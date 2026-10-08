import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { CATEGORIES } from "../../src/shared/triage/categories.ts";
import { TRIAGE_JSON_SCHEMA, TriageOutputSchema } from "../../src/shared/triage/schema.ts";
import { seed } from "../helpers/world.ts";

beforeAll(async () => {
  await seed();
  const at = "2026-10-08T15:00:00.000Z";
  await env.DB.prepare(
    "INSERT INTO facilities_requests (id, site_id, reporter_id, title, description, status, created_at, updated_at) VALUES ('req_cat', 'hq', 'emp_001', 'Broken chair', 'The chair near my desk is broken.', 'submitted', ?, ?)",
  )
    .bind(at, at)
    .run();
});

describe("the four categories (SPEC 10.1)", () => {
  it("has exactly four", () => {
    expect(CATEGORIES).toHaveLength(4);
    expect(CATEGORIES).toEqual(["building_systems", "electrical_av", "furniture_fixtures", "cleaning_safety"]);
  });

  it("matches the JSON Schema enum and the zod enum", () => {
    expect(TRIAGE_JSON_SCHEMA.properties.category.enum).toEqual([...CATEGORIES]);
    expect(TriageOutputSchema.shape.category.options).toEqual([...CATEGORIES]);
  });

  it("matches the D1 CHECK constraints: each of the four inserts, a fifth fails", async () => {
    const insert = (category: string) =>
      env.DB.prepare(
        "INSERT OR REPLACE INTO triage_suggestions (request_id, category, confidence, rationale, provider, model, attempts, latency_ms, created_at) VALUES ('req_cat', ?, 0.5, 'r', 'stub', 'keyword-v1', 1, 1, 'x')",
      )
        .bind(category)
        .run();
    for (const c of CATEGORIES) await expect(insert(c)).resolves.toBeTruthy();
    await expect(insert("landscaping")).rejects.toThrow(/CHECK constraint failed/);
    await expect(
      env.DB.prepare("UPDATE facilities_requests SET final_category = 'landscaping' WHERE id = 'req_cat'").run(),
    ).rejects.toThrow(/CHECK constraint failed/);
  });
});
