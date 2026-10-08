import type { Role } from "../../shared/roles.ts";

export interface EmployeeRow {
  id: string;
  email: string;
  displayName: string;
  department: string;
  role: Role;
  homeSiteId: string;
  active: boolean;
}

const COLUMNS =
  "id, email, display_name AS displayName, department, role, home_site_id AS homeSiteId, active";

type RawRow = Omit<EmployeeRow, "active"> & { active: number };
const toRow = (r: RawRow): EmployeeRow => ({ ...r, active: r.active === 1 });

export async function findActiveEmployeeByEmail(db: D1Database, email: string): Promise<EmployeeRow | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM employees WHERE email = ? AND active = 1`).bind(email).first<RawRow>();
  return row ? toRow(row) : null;
}

export async function findEmployeeById(db: D1Database, id: string): Promise<EmployeeRow | null> {
  const row = await db.prepare(`SELECT ${COLUMNS} FROM employees WHERE id = ?`).bind(id).first<RawRow>();
  return row ? toRow(row) : null;
}

export async function listEmployees(db: D1Database): Promise<EmployeeRow[]> {
  const { results } = await db.prepare(`SELECT ${COLUMNS} FROM employees ORDER BY id`).all<RawRow>();
  return results.map(toRow);
}

export async function displayNames(db: D1Database, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 90) {
    const chunk = unique.slice(i, i + 90);
    const { results } = await db
      .prepare(`SELECT id, display_name AS displayName FROM employees WHERE id IN (${chunk.map(() => "?").join(",")})`)
      .bind(...chunk)
      .all<{ id: string; displayName: string }>();
    for (const r of results) out.set(r.id, r.displayName);
  }
  return out;
}
