// The production catalog seed (scripts/export-catalog-sql.ts) applied to the real D1
// migrations in SQLite: it seeds the site, 20 resources and the sign-in people, and
// applying it again changes nothing except to converge the people rows.
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { catalogSql } from "../../scripts/export-catalog-sql.ts";
import { PERSONAS } from "../../scripts/lib/prod-config.ts";

const root = path.join(import.meta.dirname, "..", "..");

function migratedDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  const dir = path.join(root, "migrations");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) db.exec(readFileSync(path.join(dir, f), "utf8"));
  return db;
}

const count = (db: DatabaseSync, table: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n);

describe("production catalog SQL", () => {
  it("seeds one site, 20 resources and the owner plus personas with their roles", () => {
    const db = migratedDb();
    db.exec(catalogSql(PERSONAS, "2026-10-15T00:00:00.000Z"));
    expect(count(db, "sites")).toBe(1);
    expect(count(db, "resources")).toBe(20);
    expect(count(db, "employees")).toBe(PERSONAS.length);
    const rows = db.prepare("SELECT id, email, role, active FROM employees ORDER BY id").all();
    expect(rows).toEqual(
      [...PERSONAS].sort((a, b) => a.id.localeCompare(b.id)).map((p) => ({ id: p.id, email: p.email, role: p.role, active: 1 })),
    );
  });

  it("is idempotent, keeps admin edits to resources, and converges the people rows", () => {
    const db = migratedDb();
    db.exec(catalogSql(PERSONAS, "2026-10-15T00:00:00.000Z"));
    db.exec("UPDATE resources SET active = 0 WHERE id = (SELECT id FROM resources ORDER BY id LIMIT 1)");
    db.exec("UPDATE employees SET role = 'employee', active = 0 WHERE id = 'emp_staff'");
    const before = db.prepare("SELECT * FROM resources ORDER BY id").all();
    db.exec(catalogSql(PERSONAS, "2026-10-16T00:00:00.000Z"));
    expect(db.prepare("SELECT * FROM resources ORDER BY id").all()).toEqual(before);
    expect(count(db, "employees")).toBe(PERSONAS.length);
    expect(db.prepare("SELECT role, active, created_at FROM employees WHERE id = 'emp_staff'").get()).toEqual({
      role: "facilities_staff",
      active: 1,
      created_at: "2026-10-15T00:00:00.000Z",
    });
  });

  it("refuses a people list without an admin or with a non-email", () => {
    const staff = PERSONAS.filter((p) => p.role !== "facilities_admin");
    expect(() => catalogSql(staff, "x")).toThrow(/facilities admin/);
    expect(() => catalogSql([{ ...(PERSONAS[0] as (typeof PERSONAS)[number]), email: "nobody" }], "x")).toThrow(/not an email/);
  });
});
