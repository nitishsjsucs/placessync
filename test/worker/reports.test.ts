import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import { ADMIN } from "../helpers/tokens.ts";
import { reviewBuckets } from "../../src/worker/repo/reports.ts";
import { as, json, seed } from "../helpers/world.ts";

const DATE = "2026-10-12";

beforeAll(async () => {
  await seed();
  await env.DB.exec("DELETE FROM reservation_facts");
  const fact = (id: string, resource: string, kind: string, start: number, end: number, status: string, version: number) =>
    env.DB.prepare(
      `INSERT INTO reservation_facts (reservation_id, site_id, resource_id, resource_kind, employee_id, date, start_min, end_min, attendees,
         status, created_at, cancelled_at, ledger_version, projected_at)
       VALUES (?, 'hq', ?, ?, 'emp_001', ?, ?, ?, 1, ?, '2026-10-08T00:00:00.000Z', NULL, ?, '2026-10-08T00:00:01.000Z')`,
    ).bind(id, resource, kind, DATE, start, end, status, version);
  await env.DB.batch([
    fact("r1", "res_2a01", "desk", 540, 660, "confirmed", 1),
    fact("r2", "res_2a01", "desk", 720, 840, "confirmed", 2),
    fact("r3", "res_redwood", "room", 600, 630, "confirmed", 3),
    fact("r4", "res_redwood", "room", 660, 720, "cancelled", 5),
  ]);
});

describe("D1 reporting views (SPEC 6.1)", () => {
  it("v_resource_daily_utilization via the admin report", async () => {
    const admin = await as(ADMIN);
    const body = await json<{ rows: unknown[]; totals: Record<string, number> }>(
      await admin.get(`/api/admin/reports/utilization?from=${DATE}&to=${DATE}`),
    );
    // Open hours 07:00 to 19:00 = 720 minutes. res_2a01: 240 / 720; Redwood: 30 / 720.
    expect(body.rows).toEqual([
      { resourceId: "res_2a01", kind: "desk", name: "Desk 2A-01", date: DATE, bookings: 2, bookedMin: 240, utilization: 0.3333 },
      { resourceId: "res_redwood", kind: "room", name: "Redwood", date: DATE, bookings: 1, bookedMin: 30, utilization: 0.0417 },
    ]);
    expect(body.totals).toEqual({ bookings: 3, bookedMin: 270, resourceDays: 2, openMinutesPerDay: 720 });
    expect((body as unknown as { daily: unknown[] }).daily).toEqual([
      { date: DATE, resourceKind: "desk", confirmed: 2, cancelled: 0 },
      { date: DATE, resourceKind: "room", confirmed: 1, cancelled: 1 },
    ]);
  });

  it("filters the utilization report by kind", async () => {
    const admin = await as(ADMIN);
    const body = await json<{ rows: { kind: string }[] }>(await admin.get(`/api/admin/reports/utilization?from=${DATE}&to=${DATE}&kind=room`));
    expect(body.rows.map((r) => r.kind)).toEqual(["room"]);
  });

  it("v_hourly_occupancy counts bookings overlapping each hour", async () => {
    const admin = await as(ADMIN);
    const body = await json<{ hourly: { resourceKind: string; hour: number; occupied: number }[] }>(
      await admin.get(`/api/admin/reports/utilization?from=${DATE}&to=${DATE}`),
    );
    const byKey = Object.fromEntries(body.hourly.map((h) => [`${h.resourceKind}:${h.hour}`, h.occupied]));
    expect(byKey).toEqual({ "desk:9": 1, "desk:10": 1, "desk:12": 1, "desk:13": 1, "room:10": 1 });
  });

  it("v_daily_booking_summary splits confirmed and cancelled", async () => {
    const { results } = await env.DB.prepare(
      "SELECT resource_kind, confirmed, cancelled FROM v_daily_booking_summary WHERE site_id = 'hq' AND date = ? ORDER BY resource_kind",
    )
      .bind(DATE)
      .all();
    expect(results).toEqual([
      { resource_kind: "desk", confirmed: 2, cancelled: 0 },
      { resource_kind: "room", confirmed: 1, cancelled: 1 },
    ]);
  });

  it("raw facts for a day via /api/admin/reports/reservations", async () => {
    const admin = await as(ADMIN);
    const body = await json<{ facts: { reservationId: string }[] }>(await admin.get(`/api/admin/reports/reservations?date=${DATE}`));
    expect(body.facts.map((f) => f.reservationId)).toEqual(["r1", "r2", "r3", "r4"]);
  });

  it("v_triage_agreement is per provider and excludes manual reviews", async () => {
    await env.DB.exec("DELETE FROM request_events");
    await env.DB.exec("DELETE FROM triage_suggestions");
    await env.DB.exec("DELETE FROM facilities_requests");
    const at = "2026-10-12T17:00:00.000Z";
    const rows: [string, string, string, string | null, string][] = [
      // id, suggested, final, decision, provider
      ["q1", "electrical_av", "electrical_av", "accepted", "stub"],
      ["q2", "cleaning_safety", "cleaning_safety", "accepted", "stub"],
      ["q3", "furniture_fixtures", "building_systems", "reassigned", "stub"],
      ["q4", "electrical_av", "furniture_fixtures", "manual", "stub"],
      ["q5", "building_systems", "building_systems", "accepted", "openai-compat"],
      ["q6", "building_systems", "building_systems", null, "keyword-fallback"],
    ];
    const stmts = rows.flatMap(([id, suggested, final, decision, provider]) => [
      env.DB.prepare(
        `INSERT INTO facilities_requests (id, site_id, reporter_id, title, description, status, triage_state, final_category, review_decision, reviewed_by, reviewed_at, created_at, updated_at)
         VALUES (?, 'hq', 'emp_001', 'Something broke', 'Something broke near my desk today.', ?, 'suggested', ?, ?, ?, ?, ?, ?)`,
      ).bind(id, decision ? "assigned" : "awaiting_review", decision ? final : null, decision, decision ? "emp_093" : null, decision ? "2026-10-12T17:30:00.000Z" : null, at, at),
      env.DB.prepare(
        "INSERT INTO triage_suggestions (request_id, category, confidence, rationale, provider, model, attempts, latency_ms, created_at) VALUES (?, ?, 0.7, 'r', ?, 'm', 1, 0, ?)",
      ).bind(id, suggested, provider, at),
    ]);
    await env.DB.batch(stmts);
    const admin = await as(ADMIN);
    const body = await json<{ agreement: unknown[]; medianMinutesToReview: number; reviewedCount: number }>(
      await admin.get("/api/admin/reports/requests?from=2026-10-12&to=2026-10-12"),
    );
    expect(body.agreement).toEqual([
      { provider: "openai-compat", reviewed: 1, agreed: 1, agreementRate: 1 },
      { provider: "stub", reviewed: 3, agreed: 2, agreementRate: 0.6667 },
    ]);
    expect(body.reviewedCount).toBe(5);
    expect(body.medianMinutesToReview).toBe(30);
  });

  it("kept: suggested by final category per provider, with the agreement query's totals and diagonal (VIZ-09)", async () => {
    await env.DB.exec("DELETE FROM request_events");
    await env.DB.exec("DELETE FROM triage_suggestions");
    await env.DB.exec("DELETE FROM facilities_requests");
    const at = "2026-10-12T17:00:00.000Z";
    const rows: [string, string, string, string | null, string, string][] = [
      // id, suggested, final, decision, provider, created_at
      ["k1", "electrical_av", "electrical_av", "accepted", "stub", at],
      ["k2", "electrical_av", "electrical_av", "accepted", "stub", at],
      ["k3", "furniture_fixtures", "building_systems", "reassigned", "stub", at],
      ["k4", "furniture_fixtures", "building_systems", "reassigned", "stub", at],
      ["k5", "furniture_fixtures", "furniture_fixtures", "accepted", "stub", at],
      // A manual categorization never showed a suggestion: left out.
      ["k6", "cleaning_safety", "building_systems", "manual", "stub", at],
      // Another provider is kept apart, never merged.
      ["k7", "furniture_fixtures", "building_systems", "reassigned", "workers-ai", at],
      ["k8", "building_systems", "building_systems", "accepted", "workers-ai", at],
      // Not reviewed yet, and reviewed but outside the range: left out.
      ["k9", "building_systems", "building_systems", null, "stub", at],
      ["k10", "electrical_av", "cleaning_safety", "reassigned", "stub", "2026-10-20T17:00:00.000Z"],
    ];
    await env.DB.batch(
      rows.flatMap(([id, suggested, final, decision, provider, created]) => [
        env.DB.prepare(
          `INSERT INTO facilities_requests (id, site_id, reporter_id, title, description, status, triage_state, final_category, review_decision, reviewed_by, reviewed_at, created_at, updated_at)
           VALUES (?, 'hq', 'emp_001', 'Something broke', 'Something broke near my desk today.', ?, 'suggested', ?, ?, ?, ?, ?, ?)`,
        ).bind(id, decision ? "assigned" : "awaiting_review", decision ? final : null, decision, decision ? "emp_093" : null, decision ? "2026-10-12T18:00:00.000Z" : null, created, created),
        env.DB.prepare(
          "INSERT INTO triage_suggestions (request_id, category, confidence, rationale, provider, model, attempts, latency_ms, created_at) VALUES (?, ?, 0.7, 'r', ?, 'm', 1, 0, ?)",
        ).bind(id, suggested, provider, created),
      ]),
    );
    const admin = await as(ADMIN);
    const body = await json<{
      agreement: { provider: string; reviewed: number; agreed: number }[];
      kept: { provider: string; suggested: string; final: string; n: number }[];
      reviewBuckets: { bucket: string; n: number }[];
      reviewedCount: number;
    }>(await admin.get("/api/admin/reports/requests?from=2026-10-12&to=2026-10-12"));
    expect(body.kept).toEqual([
      { provider: "stub", suggested: "electrical_av", final: "electrical_av", n: 2 },
      { provider: "stub", suggested: "furniture_fixtures", final: "building_systems", n: 2 },
      { provider: "stub", suggested: "furniture_fixtures", final: "furniture_fixtures", n: 1 },
      { provider: "workers-ai", suggested: "building_systems", final: "building_systems", n: 1 },
      { provider: "workers-ai", suggested: "furniture_fixtures", final: "building_systems", n: 1 },
    ]);
    for (const a of body.agreement) {
      const cells = body.kept.filter((k) => k.provider === a.provider);
      expect(cells.reduce((n, k) => n + k.n, 0)).toBe(a.reviewed);
      expect(cells.filter((k) => k.suggested === k.final).reduce((n, k) => n + k.n, 0)).toBe(a.agreed);
    }
    // Every review in range, manual ones included, an hour after submission.
    expect(body.reviewBuckets).toEqual([
      { bucket: "under_1h", n: 0 },
      { bucket: "1h_to_4h", n: 8 },
      { bucket: "4h_to_24h", n: 0 },
      { bucket: "over_24h", n: 0 },
    ]);
    expect(body.reviewBuckets.reduce((n, b) => n + b.n, 0)).toBe(body.reviewedCount);
  });

  it("reviewBuckets puts each review in one of four buckets at 1, 4 and 24 hours", () => {
    expect(reviewBuckets([0, 59, 59.9, 60, 239, 240, 1439, 1440, 5000])).toEqual([
      { bucket: "under_1h", n: 3 },
      { bucket: "1h_to_4h", n: 2 },
      { bucket: "4h_to_24h", n: 2 },
      { bucket: "over_24h", n: 2 },
    ]);
    expect(reviewBuckets([]).map((b) => b.n)).toEqual([0, 0, 0, 0]);
  });

  it("selects requests by site-local date, not by UTC date", async () => {
    await env.DB.exec("DELETE FROM request_events");
    await env.DB.exec("DELETE FROM triage_suggestions");
    await env.DB.exec("DELETE FROM facilities_requests");
    // 2026-10-12T03:00Z is 20:00 on Oct 11 in Los Angeles; 2026-10-13T06:30Z is 23:30 on Oct 12.
    const rows: [string, string][] = [
      ["evening_before", "2026-10-12T03:00:00.000Z"],
      ["morning", "2026-10-12T15:00:00.000Z"],
      ["late_evening", "2026-10-13T06:30:00.000Z"],
      ["next_day", "2026-10-13T07:00:00.000Z"],
    ];
    await env.DB.batch(
      rows.map(([id, at]) =>
        env.DB.prepare(
          `INSERT INTO facilities_requests (id, site_id, reporter_id, title, description, status, triage_state, created_at, updated_at)
           VALUES (?, 'hq', 'emp_001', 'Something broke', 'Something broke near my desk today.', 'submitted', 'pending', ?, ?)`,
        ).bind(id, at, at),
      ),
    );
    const admin = await as(ADMIN);
    const count = async (from: string, to: string) => {
      const body = await json<{ categories: { n: number }[] }>(await admin.get(`/api/admin/reports/requests?from=${from}&to=${to}`));
      return body.categories.reduce((n, c) => n + c.n, 0);
    };
    expect(await count("2026-10-12", "2026-10-12")).toBe(2);
    expect(await count("2026-10-11", "2026-10-11")).toBe(1);
    expect(await count("2026-10-13", "2026-10-13")).toBe(1);
    expect(await count("2026-10-11", "2026-10-13")).toBe(4);
  });
});
