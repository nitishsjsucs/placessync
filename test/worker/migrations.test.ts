import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

// The setup file applied migrations/*.sql; this checks the resulting schema (SPEC 6.1).
describe("D1 migrations", () => {
  it("creates every table and view", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations' ORDER BY name",
    ).all<{ name: string; type: string }>();
    expect(results.map((r) => `${r.type}:${r.name}`)).toEqual([
      "table:amenities",
      "table:employees",
      "table:facilities_requests",
      "table:projection_state",
      "table:report_hours",
      "table:request_events",
      "table:reservation_facts",
      "table:resource_amenities",
      "table:resources",
      "table:sites",
      "table:triage_suggestions",
      "view:v_daily_booking_summary",
      "view:v_hourly_occupancy",
      "view:v_request_category_summary",
      "view:v_resource_daily_utilization",
      "view:v_triage_agreement",
    ]);
  });

  it("seeds report hours 07 to 18", async () => {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n, MIN(hour) AS lo, MAX(hour) AS hi FROM report_hours").first();
    expect(row).toEqual({ n: 12, lo: 7, hi: 18 });
  });

  it("keeps the naive control table out of the migrations (SPEC 6.1, m2)", async () => {
    const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'naive_reservations'").first<{ n: number }>();
    expect(row?.n).toBe(0);
  });

  it("allows only one reviewed event per request", async () => {
    const at = "2026-10-08T15:00:00.000Z";
    await env.DB.batch([
      env.DB.prepare("INSERT INTO sites (id, name, timezone, open_min, close_min) VALUES ('hq','HQ','America/Los_Angeles',420,1140)"),
      env.DB.prepare(
        "INSERT INTO employees (id, email, display_name, department, role, home_site_id, created_at) VALUES ('emp_001','a.b@placessync.test','A B','Eng','employee','hq',?)",
      ).bind(at),
      env.DB.prepare(
        "INSERT INTO facilities_requests (id, site_id, reporter_id, title, description, status, created_at, updated_at) VALUES ('req_1','hq','emp_001','Broken chair','The chair near my desk is broken.','submitted',?,?)",
      ).bind(at, at),
    ]);
    const insert = (type: string) =>
      env.DB.prepare("INSERT OR IGNORE INTO request_events (request_id, type, at) VALUES ('req_1', ?, ?)").bind(type, at);
    await env.DB.batch([insert("reviewed"), insert("reviewed"), insert("triaged"), insert("triaged")]);
    const rows = await env.DB.prepare("SELECT type, COUNT(*) AS n FROM request_events GROUP BY type ORDER BY type").all();
    expect(rows.results).toEqual([
      { type: "reviewed", n: 1 },
      { type: "triaged", n: 2 },
    ]);
  });
});
