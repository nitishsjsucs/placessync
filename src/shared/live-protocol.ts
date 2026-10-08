// WebSocket live protocol (SPEC 7.2). Deltas carry a per-date version (dateVersion) for
// gap detection and the global ledgerVersion for information only (ADR 0007).
import { z } from "zod";

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("subscribe"), date }),
  z.object({ type: z.literal("unsubscribe"), date }),
  z.object({ type: z.literal("subscribe_staff") }),
  z.object({ type: z.literal("ping") }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

const busy = z.object({ startMin: z.number().int(), endMin: z.number().int(), mine: z.boolean() });

export const SnapshotMessage = z.object({
  type: z.literal("snapshot"),
  date,
  dateVersion: z.number().int(),
  ledgerVersion: z.number().int(),
  busy: z.record(z.string(), z.array(busy)),
});

export const DeltaMessage = z.object({
  type: z.literal("delta"),
  date,
  dateVersion: z.number().int(),
  ledgerVersion: z.number().int(),
  op: z.enum(["booked", "released"]),
  resourceId: z.string(),
  startMin: z.number().int(),
  endMin: z.number().int(),
  mine: z.boolean(),
});

export const STAFF_EVENTS = ["triage_ready", "triage_overdue", "triage_unavailable", "request_updated"] as const;
export type StaffEventName = (typeof STAFF_EVENTS)[number];

export const StaffEventMessage = z.object({
  type: z.literal("staff_event"),
  event: z.enum(STAFF_EVENTS),
  requestId: z.string(),
  category: z.string().optional(),
});

export const LIVE_ERROR_CODES = ["bad_message", "forbidden", "too_many_dates", "session_expired"] as const;
export const ErrorMessage = z.object({ type: z.literal("error"), code: z.enum(LIVE_ERROR_CODES) });

export const PongMessage = z.object({ type: z.literal("pong") });

export const ServerMessage = z.discriminatedUnion("type", [SnapshotMessage, DeltaMessage, StaffEventMessage, ErrorMessage, PongMessage]);
export type ServerMessage = z.infer<typeof ServerMessage>;
export type SnapshotMessage = z.infer<typeof SnapshotMessage>;
export type DeltaMessage = z.infer<typeof DeltaMessage>;
export type StaffEventMessage = z.infer<typeof StaffEventMessage>;

export const MAX_SUBSCRIBED_DATES = 14;
/** Close code for an expired session; the client reconnects and re-authenticates. */
export const CLOSE_SESSION_EXPIRED = 4001;
export const PING = '{"type":"ping"}';
export const PONG = '{"type":"pong"}';
