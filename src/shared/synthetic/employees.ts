import { type Rng, mulberry32, pick, shuffle } from "../rng.ts";
import type { Role } from "../roles.ts";
import { FIRST_NAMES, LAST_NAMES } from "./names.ts";

export interface Employee {
  id: string;
  email: string;
  displayName: string;
  department: string;
  role: Role;
  homeSiteId: string;
  active: boolean;
  createdAt: string;
}

/** 92 employees by department (SPEC 11.1); the order of assignment is shuffled by seed. */
export const DEPARTMENT_COUNTS: readonly (readonly [string, number])[] = [
  ["Engineering", 30],
  ["Product", 10],
  ["Design", 8],
  ["Sales", 16],
  ["Operations", 12],
  ["People", 6],
  ["Finance", 10],
];

export const EMPLOYEE_COUNT = 100;
const CREATED_AT = "2026-09-01T16:00:00.000Z";

export function employeeId(n: number): string {
  return `emp_${String(n).padStart(3, "0")}`;
}

function roleFor(n: number): Role {
  if (n <= 92) return "employee";
  if (n <= 98) return "facilities_staff";
  return "facilities_admin";
}

/** Exactly 100: emp_001..emp_092 employee, emp_093..emp_098 facilities_staff, emp_099..emp_100 facilities_admin. */
export function generateEmployees(seed: number): Employee[] {
  const rng: Rng = mulberry32(seed ^ 0x0e3a1);
  const departments = shuffle(
    rng,
    DEPARTMENT_COUNTS.flatMap(([d, n]) => Array.from({ length: n }, () => d)),
  );
  const usedEmails = new Map<string, number>();
  const out: Employee[] = [];
  for (let n = 1; n <= EMPLOYEE_COUNT; n++) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const base = `${first}.${last}`.toLowerCase();
    const seen = usedEmails.get(base) ?? 0;
    usedEmails.set(base, seen + 1);
    const local = seen === 0 ? base : `${base}${seen + 1}`;
    const role = roleFor(n);
    out.push({
      id: employeeId(n),
      email: `${local}@placessync.test`,
      displayName: `${first} ${last}`,
      department: role === "employee" ? (departments[n - 1] as string) : "Facilities",
      role,
      homeSiteId: "hq",
      active: true,
      createdAt: CREATED_AT,
    });
  }
  return out;
}
