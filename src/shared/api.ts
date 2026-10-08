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

export const DateQuery = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD") });
export const DateRangeQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
  kind: ResourceKindSchema.optional(),
});

const minuteParam = z
  .string()
  .regex(/^\d{1,4}$/, "minutes since midnight")
  .transform(Number)
  .pipe(z.number().int().min(0).max(1440));

export const AvailabilityQuery = ResourceFiltersSchema.extend({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
  from: minuteParam.optional(),
  to: minuteParam.optional(),
});

export const AvailabilityResponse = z.object({
  date: z.string(),
  /** The per-date version (ADR 0007); live deltas for this date continue from it. */
  version: z.number().int(),
  ledgerVersion: z.number().int(),
  resources: z.array(
    z.object({
      resource: ResourceSchema,
      busy: z.array(BusyIntervalSchema),
      freeWindows: z.array(IntervalSchema),
      fitsWindow: z.boolean(),
    }),
  ),
});
export type AvailabilityResponse = z.infer<typeof AvailabilityResponse>;

export const CalendarQuery = z.object({ weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD") });
export const CalendarResponse = z.object({
  resource: ResourceSchema,
  days: z.array(
    z.object({
      date: z.string(),
      busy: z.array(BusyIntervalSchema.extend({ reservationId: z.string().optional() })),
    }),
  ),
});
export type CalendarResponse = z.infer<typeof CalendarResponse>;

export const ReserveResponse = z.object({ reservation: ReservationSchema, version: z.number().int(), dateVersion: z.number().int() });
export type ReserveResponse = z.infer<typeof ReserveResponse>;

export const ReservationsQuery = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "use YYYY-MM-DD"),
  status: z.enum(["confirmed", "cancelled"]).optional(),
  employeeId: z.string().regex(/^emp_\d{3}$/).optional(),
});
export const ReservationsResponse = z.object({ reservations: z.array(ReservationSchema) });
export type ReservationsResponse = z.infer<typeof ReservationsResponse>;

export const CancelBody = z.object({ reason: z.string().trim().max(200).optional() });

// Facilities requests (SPEC 7.3, 8).
export const CategorySchema = z.enum(["building_systems", "electrical_av", "furniture_fixtures", "cleaning_safety"]);
export const RequestStatusSchema = z.enum(["submitted", "awaiting_review", "assigned", "in_progress", "resolved", "cancelled"]);
export const TriageStateSchema = z.enum(["pending", "suggested", "unavailable"]);
export const SuggestionProviderSchema = z.enum(["workers-ai", "openai-compat", "stub", "keyword-fallback"]);

export const TITLE_MIN = 5;
export const TITLE_MAX_LEN = 120;
export const DESCRIPTION_MIN = 20;
export const DESCRIPTION_MAX = 2000;

export const CreateRequestBody = z.object({
  siteId: z.string().min(1).max(32),
  resourceId: z.string().min(1).max(64).optional(),
  locationNote: z.string().trim().max(200).optional(),
  title: z.string().trim().min(TITLE_MIN, `Title needs at least ${TITLE_MIN} characters.`).max(TITLE_MAX_LEN, `Title is limited to ${TITLE_MAX_LEN} characters.`),
  description: z
    .string()
    .trim()
    .min(DESCRIPTION_MIN, `Description needs at least ${DESCRIPTION_MIN} characters.`)
    .max(DESCRIPTION_MAX, `Description is limited to ${DESCRIPTION_MAX} characters.`),
});
export type CreateRequestBody = z.infer<typeof CreateRequestBody>;

export const FacilitiesRequestSchema = z.object({
  id: z.string(),
  siteId: z.string(),
  reporterId: z.string(),
  reporterName: z.string().nullable(),
  resourceId: z.string().nullable(),
  resourceName: z.string().nullable(),
  locationNote: z.string(),
  title: z.string(),
  description: z.string(),
  status: RequestStatusSchema,
  triageState: TriageStateSchema,
  triageAttempts: z.number().int(),
  finalCategory: CategorySchema.nullable(),
  reviewDecision: z.enum(["accepted", "reassigned", "manual"]).nullable(),
  reviewedBy: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type FacilitiesRequest = z.infer<typeof FacilitiesRequestSchema>;

export const SuggestionSchema = z.object({
  category: CategorySchema,
  confidence: z.number(),
  rationale: z.string(),
  provider: SuggestionProviderSchema,
  model: z.string(),
  attempts: z.number().int(),
  latencyMs: z.number().int(),
  createdAt: z.string(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const RequestEventSchema = z.object({
  id: z.number().int(),
  type: z.string(),
  actorId: z.string().nullable(),
  data: z.record(z.string(), z.unknown()),
  at: z.string(),
});
export type RequestEvent = z.infer<typeof RequestEventSchema>;

export const RequestWithSuggestion = FacilitiesRequestSchema.extend({ suggestion: SuggestionSchema.nullable() });
export type RequestWithSuggestion = z.infer<typeof RequestWithSuggestion>;

export const CreateRequestResponse = z.object({ request: FacilitiesRequestSchema, triage: z.enum(["started", "pending"]) });
export type CreateRequestResponse = z.infer<typeof CreateRequestResponse>;

export const MyRequestsResponse = z.object({ requests: z.array(RequestWithSuggestion) });
export type MyRequestsResponse = z.infer<typeof MyRequestsResponse>;

export const RequestDetailResponse = z.object({
  request: FacilitiesRequestSchema,
  suggestion: SuggestionSchema.nullable(),
  events: z.array(RequestEventSchema),
});
export type RequestDetailResponse = z.infer<typeof RequestDetailResponse>;

export const StaffQueueItem = RequestWithSuggestion.extend({ ageMinutes: z.number().int() });
export const StaffQueueResponse = z.object({ requests: z.array(StaffQueueItem) });
export type StaffQueueResponse = z.infer<typeof StaffQueueResponse>;

export const StaffQueueQuery = z.object({
  status: RequestStatusSchema.optional(),
  category: CategorySchema.optional(),
  q: z.string().trim().max(80).optional(),
});

export const MyRequestsQuery = z.object({ status: RequestStatusSchema.optional() });

export const ReviewBody = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("accept") }),
  z.object({ decision: z.literal("reassign"), category: CategorySchema }),
  z.object({ decision: z.literal("categorize"), category: CategorySchema }),
]);
export type ReviewBody = z.infer<typeof ReviewBody>;

export const StatusChangeBody = z.object({ status: z.enum(["in_progress", "resolved"]), note: z.string().trim().max(500).optional() });
