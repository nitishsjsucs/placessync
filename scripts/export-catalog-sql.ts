// Production catalog seed (SPEC 17 step 6): the site, amenities, the 20 resources and ONE
// facilities admin whose email is passed on the command line. No synthetic logins, and the
// email is never hardcoded or committed (write the output under the gitignored .seed/).
//
//   mkdir -p .seed && node scripts/export-catalog-sql.ts --admin-email you@example.com > .seed/catalog.sql
import { parseArgs } from "node:util";
import { AMENITIES, SITE, generateResources } from "../src/shared/synthetic/resources.ts";

const { values } = parseArgs({ options: { "admin-email": { type: "string" }, "admin-name": { type: "string", default: "Facilities Admin" } } });
const email = values["admin-email"];
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("usage: node scripts/export-catalog-sql.ts --admin-email <email> [--admin-name <name>] > .seed/catalog.sql");
  process.exit(2);
}

const q = (s: string | number) => (typeof s === "number" ? String(s) : `'${s.replace(/'/g, "''")}'`);
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
lines.push(
  `INSERT INTO employees (id, email, display_name, department, role, home_site_id, active, created_at) VALUES ('emp_admin', ${q(email)}, ${q(String(values["admin-name"]))}, 'Facilities', 'facilities_admin', 'hq', 1, ${q(new Date().toISOString())}) ON CONFLICT(id) DO NOTHING;`,
);
console.log(lines.join("\n"));
