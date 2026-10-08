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

export const ResourceKindSchema = z.enum(["desk", "room"]);

export const ResourceSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  kind: ResourceKindSchema,
  name: z.string(),
  floor: z.number().int(),
  zone: z.string(),
  capacity: z.number().int(),
  description: z.string(),
  active: z.boolean(),
  amenities: z.array(z.string()),
});
export type Resource = z.infer<typeof ResourceSchema>;

const optionalInt = (min: number) =>
  z
    .string()
    .regex(/^\d+$/, "must be a whole number")
    .transform(Number)
    .pipe(z.number().int().min(min))
    .optional();

/** Query filters shared by resource search and availability (SPEC 8). */
export const ResourceFiltersSchema = z.object({
  kind: ResourceKindSchema.optional(),
  floor: optionalInt(0),
  amenity: z
    .string()
    .max(200)
    .transform((s) =>
      s
        .split(",")
        .map((a) => a.trim())
        .filter(Boolean),
    )
    .optional(),
  minCapacity: optionalInt(1),
  q: z.string().trim().max(80).optional(),
});
export type ResourceFilters = z.output<typeof ResourceFiltersSchema>;

export const ResourcesResponse = z.object({ resources: z.array(ResourceSchema) });
export type ResourcesResponse = z.infer<typeof ResourcesResponse>;

export const IntervalSchema = z.object({ startMin: z.number().int(), endMin: z.number().int() });
export const BusyIntervalSchema = IntervalSchema.extend({ mine: z.boolean() });
export type BusyInterval = z.infer<typeof BusyIntervalSchema>;

export const ReservationSchema = z.object({
  id: z.string(),
  resourceId: z.string(),
  employeeId: z.string(),
  kind: ResourceKindSchema,
  date: z.string(),
  startMin: z.number().int(),
  endMin: z.number().int(),
  attendees: z.number().int(),
  title: z.string().nullable(),
  status: z.enum(["confirmed", "cancelled"]),
  createdAt: z.string(),
  cancelledAt: z.string().nullable(),
  cancelledBy: z.string().nullable(),
  cancelReason: z.string().nullable(),
  version: z.number().int(),
});
export type Reservation = z.infer<typeof ReservationSchema>;

/** POST /api/reservations body: types only; the ledger applies the booking rules. */
export const ReserveBody = z.object({
  resourceId: z.string().min(1).max(64),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
  startMin: z.number().int().min(0).max(1440),
  endMin: z.number().int().min(0).max(1440),
  attendees: z.number().int().min(1).max(100).optional(),
  title: z.string().trim().max(80).optional(),
});
export type ReserveBody = z.infer<typeof ReserveBody>;
