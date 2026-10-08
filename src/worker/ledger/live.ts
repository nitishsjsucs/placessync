// Per-socket attachment and broadcast helpers (SPEC 7.1, 7.2). Attachments survive
// hibernation; every send first checks the token expiry carried in the attachment.
import { CLOSE_SESSION_EXPIRED, type DeltaMessage, type StaffEventMessage } from "../../shared/live-protocol.ts";
import type { Role } from "../../shared/roles.ts";

export interface LiveAttachment {
  employeeId: string;
  role: Role;
  /** True once the socket sent subscribe_staff with a staff or admin role. */
  staff: boolean;
  /** Token expiry, seconds since the epoch. */
  exp: number;
  dates: string[];
}

export interface LiveActor {
  employeeId: string;
  role: Role;
  exp: number;
}

export const ACTOR_HEADER = "X-PlacesSync-Actor";

export function attachmentOf(ws: WebSocket): LiveAttachment | null {
  return (ws.deserializeAttachment() as LiveAttachment | null) ?? null;
}

export function isExpired(att: LiveAttachment, nowMs: number): boolean {
  return nowMs >= att.exp * 1000;
}

export function send(ws: WebSocket, message: unknown): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // The socket is closing; nothing to do.
  }
}

export function closeExpired(ws: WebSocket): void {
  send(ws, { type: "error", code: "session_expired" });
  try {
    ws.close(CLOSE_SESSION_EXPIRED, "session expired");
  } catch {
    // Already closed.
  }
}

export interface ReservationChange {
  op: "booked" | "released";
  date: string;
  dateVersion: number;
  ledgerVersion: number;
  resourceId: string;
  employeeId: string;
  startMin: number;
  endMin: number;
}

/** Sends a delta to sockets subscribed to the change's date only; never another employee's id. */
export function broadcastDelta(sockets: WebSocket[], change: ReservationChange, nowMs: number): number {
  let delivered = 0;
  for (const ws of sockets) {
    const att = attachmentOf(ws);
    if (!att) continue;
    if (isExpired(att, nowMs)) {
      closeExpired(ws);
      continue;
    }
    if (!att.dates.includes(change.date)) continue;
    const msg: DeltaMessage = {
      type: "delta",
      date: change.date,
      dateVersion: change.dateVersion,
      ledgerVersion: change.ledgerVersion,
      op: change.op,
      resourceId: change.resourceId,
      startMin: change.startMin,
      endMin: change.endMin,
      mine: att.employeeId === change.employeeId,
    };
    send(ws, msg);
    delivered++;
  }
  return delivered;
}

export function broadcastStaff(sockets: WebSocket[], event: Omit<StaffEventMessage, "type">, nowMs: number): number {
  let delivered = 0;
  for (const ws of sockets) {
    const att = attachmentOf(ws);
    if (!att?.staff) continue;
    if (isExpired(att, nowMs)) {
      closeExpired(ws);
      continue;
    }
    send(ws, { type: "staff_event", ...event });
    delivered++;
  }
  return delivered;
}
