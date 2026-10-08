// zod schemas and inferred types for every request and response body (SPEC 8). The
// Worker validates with them and the client parses responses with them.
import { z } from "zod";
import { ROLES } from "./roles.ts";

export const SiteRulesSchema = z.object({
  timezone: z.string(),
  openMin: z.number().int(),
  closeMin: z.number().int(),
  horizonDays: z.number().int(),
});

export const HealthResponse = z.object({
  ok: z.literal(true),
  authMode: z.enum(["access", "dev"]),
  triage: z.enum(["ready", "misconfigured"]),
  siteId: z.string(),
  seeded: z.boolean(),
  siteToday: z.string().nullable(),
  siteRules: SiteRulesSchema.nullable(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

export const EmployeeSummary = z.object({
  id: z.string(),
  email: z.string(),
  displayName: z.string(),
  department: z.string(),
  role: z.enum(ROLES),
});
export type EmployeeSummary = z.infer<typeof EmployeeSummary>;

export const MeResponse = z.object({ employee: EmployeeSummary });
export type MeResponse = z.infer<typeof MeResponse>;

export const DevUsersResponse = z.object({
  users: z.array(z.object({ id: z.string(), displayName: z.string(), role: z.enum(ROLES), department: z.string() })),
});
export type DevUsersResponse = z.infer<typeof DevUsersResponse>;

export const DevLoginBody = z.object({ employeeId: z.string().regex(/^emp_\d{3}$/) });
export const DevLoginResponse = z.object({ token: z.string(), expiresAt: z.string() });
export type DevLoginResponse = z.infer<typeof DevLoginResponse>;

export const DevSeedBody = z.object({ reset: z.boolean().default(false), history: z.boolean().default(false) });
export const DevSeedResponse = z.object({
  employees: z.number().int(),
  resources: z.number().int(),
  historyReservations: z.number().int(),
  requests: z.number().int(),
});
export type DevSeedResponse = z.infer<typeof DevSeedResponse>;
