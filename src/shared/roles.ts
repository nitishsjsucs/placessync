// Roles and permissions (SPEC 9.1). Roles come only from the D1 employees table.
export const ROLES = ["employee", "facilities_staff", "facilities_admin"] as const;
export type Role = (typeof ROLES)[number];

export type Permission =
  | "book"
  | "report_issue"
  | "staff_queue"
  | "review_request"
  | "change_request_status"
  | "view_bookings_day"
  | "admin_reports"
  | "admin_resources"
  | "cancel_any_booking"
  | "ledger_export";

const STAFF: readonly Permission[] = ["staff_queue", "review_request", "change_request_status", "view_bookings_day"];
const ADMIN: readonly Permission[] = ["admin_reports", "admin_resources", "cancel_any_booking", "ledger_export"];

const GRANTS: Record<Role, ReadonlySet<Permission>> = {
  employee: new Set<Permission>(["book", "report_issue"]),
  facilities_staff: new Set<Permission>(["book", "report_issue", ...STAFF]),
  facilities_admin: new Set<Permission>(["book", "report_issue", ...STAFF, ...ADMIN]),
};

export function can(role: Role, permission: Permission): boolean {
  return GRANTS[role].has(permission);
}

export function isStaff(role: Role): boolean {
  return role === "facilities_staff" || role === "facilities_admin";
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

export const ROLE_LABELS: Record<Role, string> = {
  employee: "Employee",
  facilities_staff: "Facilities staff",
  facilities_admin: "Facilities admin",
};
