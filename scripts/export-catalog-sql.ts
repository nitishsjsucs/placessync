// Production catalog seed (SPEC 17 step 6, run by `npm run prod:setup`): the site, the
// amenities, the 20 resources and the people who may sign in. No synthetic employees:
// in production every employee row is a real sign-in. By default those are the owner and
// persona addresses in scripts/lib/prod-config.ts; --admin-email seeds one admin instead
// (for someone else's deployment).
//
//   mkdir -p .seed && node scripts/export-catalog-sql.ts > .seed/catalog.sql
//   node scripts/export-catalog-sql.ts --admin-email you@example.com > .seed/catalog.sql
//
// Safe to apply again: the catalog rows are inserted only if missing (admin edits in the
// app survive), and the people rows converge to the list given here.
import { parseArgs } from "node:util";
import { AMENITIES, SITE, generateResources } from "../src/shared/synthetic/resources.ts";
import { PERSONAS, type Persona } from "./lib/prod-config.ts";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const q = (s: string | number) => (typeof s === "number" ? String(s) : `'${s.replace(/'/g, "''")}'`);

export function catalogSql(people: readonly Persona[], nowIso: string): string {
  if (people.length === 0) throw new Error("at least one person must be able to sign in");
  for (const p of people) if (!EMAIL.test(p.email)) throw new Error(`not an email address: ${p.email}`);
  if (!people.some((p) => p.role === "facilities_admin")) throw new Error("one person must be the facilities admin");
  const lines: string[] = [];
  lines.push(
    `INSERT INTO sites (id, name, timezone, open_min, close_min, horizon_days) VALUES (${[SITE.id, SITE.name, SITE.timezone, SITE.openMin, SITE.closeMin, SITE.horizonDays].map(q).join(", ")}) ON CONFLICT(id) DO NOTHING;`,
  );
  for (const a of AMENITIES) lines.push(`INSERT INTO amenities (id, label) VALUES (${q(a.id)}, ${q(a.label)}) ON CONFLICT(id) DO NOTHING;`);
  for (const r of generateResources()) {
    lines.push(
      `INSERT INTO resources (id, site_id, kind, name, floor, zone, capacity, description, active) VALUES (${[r.id, r.siteId, r.kind, r.name, r.floor, r.zone, r.capacity, r.description, 1].map(q).join(", ")}) ON CONFLICT(id) DO NOTHING;`,
    );
    for (const a of r.amenities) lines.push(`INSERT INTO resource_amenities (resource_id, amenity_id) VALUES (${q(r.id)}, ${q(a)}) ON CONFLICT DO NOTHING;`);
  }
  for (const p of people) {
    lines.push(
      `INSERT INTO employees (id, email, display_name, department, role, home_site_id, active, created_at) VALUES (${[p.id, p.email, p.displayName, p.department, p.role, SITE.id, 1, nowIso].map(q).join(", ")}) ON CONFLICT(id) DO UPDATE SET email = excluded.email, display_name = excluded.display_name, department = excluded.department, role = excluded.role, active = 1;`,
    );
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const { values } = parseArgs({ options: { "admin-email": { type: "string" }, "admin-name": { type: "string", default: "Facilities Admin" } } });
  const adminEmail = values["admin-email"];
  if (adminEmail !== undefined && !EMAIL.test(adminEmail)) {
    console.error("usage: node scripts/export-catalog-sql.ts [--admin-email <email> [--admin-name <name>]] > .seed/catalog.sql");
    process.exit(2);
  }
  const people: Persona[] = adminEmail
    ? [{ id: "emp_admin", email: adminEmail, role: "facilities_admin", displayName: String(values["admin-name"]), department: "Facilities" }]
    : [...PERSONAS];
  console.log(catalogSql(people, new Date().toISOString()));
}
