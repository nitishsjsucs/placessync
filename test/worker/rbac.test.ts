import { beforeAll, describe, expect, it } from "vitest";
import { ADMIN, EMPLOYEE, STAFF } from "../helpers/tokens.ts";
import { as, seed } from "../helpers/world.ts";

beforeAll(async () => {
  await seed();
});

type Role = "employee" | "facilities_staff" | "facilities_admin";
const USERS: Record<Role, string> = { employee: EMPLOYEE, facilities_staff: STAFF, facilities_admin: ADMIN };
const ROLES = Object.keys(USERS) as Role[];

// Route x role matrix from SPEC 8. "allow" means the role passes RBAC (any status other
// than 401/403); "deny" means 403 forbidden. Rows are added as routes land.
type Row = { method: "GET" | "POST" | "PATCH"; path: string; body?: unknown; employee: "allow" | "deny"; staff: "allow" | "deny"; admin: "allow" | "deny" };
const MATRIX: Row[] = [
  { method: "GET", path: "/api/me", employee: "allow", staff: "allow", admin: "allow" },
  { method: "GET", path: "/api/sites/hq/resources", employee: "allow", staff: "allow", admin: "allow" },
  { method: "GET", path: "/api/admin/reports/utilization?from=2026-10-01&to=2026-10-31", employee: "deny", staff: "deny", admin: "allow" },
  { method: "GET", path: "/api/admin/reports/reservations?date=2026-10-12", employee: "deny", staff: "deny", admin: "allow" },
  { method: "GET", path: "/api/admin/ledger/export?date=2026-10-12", employee: "deny", staff: "deny", admin: "allow" },
  { method: "GET", path: "/api/admin/projection/status", employee: "deny", staff: "deny", admin: "allow" },
];

describe("RBAC matrix (SPEC 8, 9.1)", () => {
  for (const row of MATRIX) {
    for (const role of ROLES) {
      const expected = role === "employee" ? row.employee : role === "facilities_staff" ? row.staff : row.admin;
      it(`${row.method} ${row.path} as ${role}: ${expected}`, async () => {
        const user = await as(USERS[role]);
        const res =
          row.method === "GET"
            ? await user.get(row.path)
            : row.method === "PATCH"
              ? await user.patch(row.path, row.body ?? {})
              : await user.post(row.path, row.body ?? {}, { "Idempotency-Key": `rbac-${role}-${row.path}`.slice(0, 64) });
        if (expected === "deny") {
          expect(res.status).toBe(403);
          expect(((await res.json()) as { error: string }).error).toBe("forbidden");
        } else {
          expect([401, 403]).not.toContain(res.status);
          await res.body?.cancel();
        }
      });
    }
  }
});

describe("site allowlist for every role (SPEC 7.5)", () => {
  for (const role of ROLES) {
    it(`GET /api/sites/evil/availability is 404 site_not_found as ${role}`, async () => {
      const user = await as(USERS[role]);
      const res = await user.get("/api/sites/evil/availability?date=2026-10-12");
      expect(res.status).toBe(404);
      expect(((await res.json()) as { error: string }).error).toBe("site_not_found");
    });
  }
});
