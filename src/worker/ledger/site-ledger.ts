// SiteLedger: the only writer of reservations for one site (SPEC 7.1, ADR 0001).
// Every booking commits in one synchronous transactionSync that checks overlaps with
// SQL and claims 15-minute slots under a PRIMARY KEY, so a missed check cannot
// produce a double booking (ADR 0002).
import { DurableObject } from "cloudflare:workers";
import type { BusyInterval, Reservation } from "../../shared/api.ts";
import type { Issue } from "../../shared/errors.ts";
import type { Interval } from "../../shared/intervals.ts";
import type { Role } from "../../shared/roles.ts";
import { type ReserveInput, type ResourceKind, type SiteRules, hasStarted, validate } from "../../shared/rules.ts";
import { addDays, slotsFor } from "../../shared/time.ts";
import { newId } from "../ids.ts";
import {
  ClientMessage,
  MAX_SUBSCRIBED_DATES,
  PING,
  PONG,
  type SnapshotMessage,
  type StaffEventMessage,
} from "../../shared/live-protocol.ts";
import { isStaff } from "../../shared/roles.ts";
import {
  ACTOR_HEADER,
  type LiveActor,
  type LiveAttachment,
  type ReservationChange,
  attachmentOf,
  broadcastDelta,
  broadcastStaff,
  closeExpired,
  isExpired,
  send,
} from "./live.ts";
import { FLUSH_BATCH, type FactPayload, flushBackoffMs, projectionStatements } from "./outbox.ts";
import { DATA_TABLES, META_DEFAULTS, applySchema } from "./schema.ts";

export interface Actor {
  employeeId: string;
  role: Role;
}

export type ReserveResult =
  | { ok: true; status: 201; reservation: Reservation; ledgerVersion: number; dateVersion: number }
  | { ok: false; status: 409; error: "resource_conflict"; conflicts: Interval[] }
  | { ok: false; status: 409; error: "employee_conflict"; conflicts: Interval[] }
  | { ok: false; status: 422; error: "validation"; issues: Issue[] }
  | { ok: false; status: 422; error: "idempotency_key_reuse" }
  | { ok: false; status: 404; error: "resource_not_found" };

export type CancelResult =
  | { ok: true; status: 200; reservation: Reservation; ledgerVersion: number; dateVersion: number }
  | { ok: false; status: 404; error: "reservation_not_found" }
  | { ok: false; status: 403; error: "not_owner" }
  | { ok: false; status: 409; error: "not_confirmed" | "already_started" };

interface ReservationRow {
  id: string;
  resource_id: string;
  employee_id: string;
  kind: ResourceKind;
  date: string;
  start_min: number;
  end_min: number;
  attendees: number;
  title: string | null;
  status: "confirmed" | "cancelled";
  created_at: number;
  cancelled_at: number | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  version: number;
}

export function toReservation(r: ReservationRow): Reservation {
  return {
    id: r.id,
    resourceId: r.resource_id,
    employeeId: r.employee_id,
    kind: r.kind,
    date: r.date,
    startMin: r.start_min,
    endMin: r.end_min,
    attendees: r.attendees,
    title: r.title,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
    cancelledAt: r.cancelled_at === null ? null : new Date(r.cancelled_at).toISOString(),
    cancelledBy: r.cancelled_by,
    cancelReason: r.cancel_reason,
    version: r.version,
  };
}

function changeOf(op: "booked" | "released", r: Reservation, ledgerVersion: number, dateVersion: number): ReservationChange {
  return { op, date: r.date, dateVersion, ledgerVersion, resourceId: r.resourceId, employeeId: r.employeeId, startMin: r.startMin, endMin: r.endMin };
}

class BackstopConflict extends Error {
  readonly table: "resource_slots" | "employee_slots";
  constructor(table: "resource_slots" | "employee_slots", message: string) {
    super(message);
    this.table = table;
  }
}

/** Canonical request fingerprint for idempotency: same key with a different body is rejected. */
async function requestHash(input: ReserveInput): Promise<string> {
  const canonical = JSON.stringify([input.resourceId, input.date, input.startMin, input.endMin, input.attendees ?? 1, input.title ?? null]);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

export class SiteLedger extends DurableObject<Env> {
  private readonly sql: SqlStorage;
  private catalogLoad: Promise<void> | null = null;
  private alarmPending = false;
  /** Tests only, set through runInDurableObject. */
  clockOverride?: () => number;
  /** Tests only: how many times syncCatalog ran in this instance. */
  catalogSyncCount = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    void ctx.blockConcurrencyWhile(async () => {
      applySchema(this.sql);
      // After eviction or a restart, unflushed outbox rows must still reach D1.
      if (this.outboxDepth() > 0 && (await ctx.storage.getAlarm()) === null) {
        await ctx.storage.setAlarm(Date.now());
        this.alarmPending = true;
      }
    });
    // Keepalives are answered without waking a hibernated object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
  }

  private now(): number {
    return this.clockOverride ? this.clockOverride() : Date.now();
  }

  private meta(key: string): string {
    return String(this.sql.exec("SELECT value FROM meta WHERE key = ?", key).toArray()[0]?.value ?? META_DEFAULTS[key] ?? "");
  }

  private setMeta(key: string, value: string | number): void {
    this.sql.exec("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", key, String(value));
  }

  private bumpLedgerVersion(): number {
    const row = this.sql
      .exec("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'ledger_version' RETURNING value")
      .one();
    return Number(row.value);
  }

  /** Bumps the per-date live version (ADR 0007) inside the caller's transaction. */
  private bumpDateVersion(date: string): number {
    const row = this.sql
      .exec("INSERT INTO date_versions (date, version) VALUES (?, 1) ON CONFLICT(date) DO UPDATE SET version = version + 1 RETURNING version", date)
      .one();
    return Number(row.version);
  }

  private dateVersion(date: string): number {
    return Number(this.sql.exec("SELECT version FROM date_versions WHERE date = ?", date).toArray()[0]?.version ?? 0);
  }

  private outboxDepth(): number {
    return Number(this.sql.exec("SELECT COUNT(*) AS n FROM outbox").one().n);
  }

  /** Writes the reservation's fact row to the outbox inside the caller's transaction (I5). */
  private enqueueFact(row: ReservationRow, now: number): void {
    const payload: FactPayload = {
      reservationId: row.id,
      siteId: String(this.sql.exec("SELECT id FROM site LIMIT 1").one().id),
      resourceId: row.resource_id,
      resourceKind: row.kind,
      employeeId: row.employee_id,
      date: row.date,
      startMin: row.start_min,
      endMin: row.end_min,
      attendees: row.attendees,
      status: row.status,
      createdAt: new Date(row.created_at).toISOString(),
      cancelledAt: row.cancelled_at === null ? null : new Date(row.cancelled_at).toISOString(),
      ledgerVersion: row.version,
    };
    this.sql.exec(
      "INSERT INTO outbox (reservation_id, version, payload, created_at) VALUES (?, ?, ?, ?)",
      row.id,
      row.version,
      JSON.stringify(payload),
      now,
    );
  }

  /** Arms the flush alarm 250 ms out unless one is already pending. */
  private async scheduleFlush(): Promise<void> {
    if (this.alarmPending) return;
    this.alarmPending = true;
    if ((await this.ctx.storage.getAlarm()) === null) await this.ctx.storage.setAlarm(Date.now() + 250);
  }

  private storeIdempotent(employeeId: string, key: string, hash: string, result: ReserveResult, now: number): void {
    this.sql.exec(
      "INSERT OR REPLACE INTO idempotency (employee_id, key, request_hash, response, created_at) VALUES (?, ?, ?, ?, ?)",
      employeeId,
      key,
      hash,
      JSON.stringify(result),
      now,
    );
  }

  private siteRules(): SiteRules {
    const row = this.sql.exec("SELECT timezone, open_min, close_min, horizon_days FROM site LIMIT 1").one();
    return {
      timezone: String(row.timezone),
      openMin: Number(row.open_min),
      closeMin: Number(row.close_min),
      horizonDays: Number(row.horizon_days),
    };
  }

  private catalogLoaded(): boolean {
    const row = this.sql.exec("SELECT (SELECT COUNT(*) FROM site) AS s, (SELECT COUNT(*) FROM resources) AS r").one();
    return Number(row.s) > 0 && Number(row.r) > 0;
  }

  /** Lazily loads the catalog from D1, single-flight: N concurrent callers share one sync. */
  private async ensureCatalog(): Promise<void> {
    if (this.catalogLoaded()) return;
    if (!this.catalogLoad) {
      this.catalogLoad = this.syncCatalog()
        .then(() => undefined)
        .finally(() => {
          this.catalogLoad = null;
        });
    }
    await this.catalogLoad;
  }

  /** Reloads the site row and resources from D1 and replaces both ledger tables. */
  async syncCatalog(): Promise<{ resources: number }> {
    this.catalogSyncCount++;
    const siteId = this.ctx.id.name;
    if (!siteId) throw new Error("unknown_site");
    const site = await this.env.DB.prepare("SELECT id, timezone, open_min, close_min, horizon_days FROM sites WHERE id = ?")
      .bind(siteId)
      .first<{ id: string; timezone: string; open_min: number; close_min: number; horizon_days: number }>();
    if (!site) throw new Error("unknown_site");
    const { results } = await this.env.DB.prepare("SELECT id, kind, capacity, active FROM resources WHERE site_id = ?")
      .bind(siteId)
      .all<{ id: string; kind: string; capacity: number; active: number }>();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("DELETE FROM site");
      this.sql.exec("DELETE FROM resources");
      this.sql.exec(
        "INSERT INTO site (id, timezone, open_min, close_min, horizon_days) VALUES (?, ?, ?, ?, ?)",
        site.id,
        site.timezone,
        site.open_min,
        site.close_min,
        site.horizon_days,
      );
      for (const r of results) {
        this.sql.exec("INSERT INTO resources (id, kind, capacity, active) VALUES (?, ?, ?, ?)", r.id, r.kind, r.capacity, r.active);
      }
      this.setMeta("catalog_synced_at", new Date(this.now()).toISOString());
    });
    return { resources: results.length };
  }

  async reserve(actor: Actor, input: ReserveInput, idempotencyKey: string): Promise<ReserveResult> {
    await this.ensureCatalog();
    const hash = await requestHash(input);
    const now = this.now();
    let replayed = false;
    try {
      const committed = this.ctx.storage.transactionSync((): ReserveResult => {
        // (1) Idempotency: the same key and body replays the stored response.
        const prior = this.sql
          .exec("SELECT request_hash, response FROM idempotency WHERE employee_id = ? AND key = ?", actor.employeeId, idempotencyKey)
          .toArray()[0];
        if (prior) {
          if (prior.request_hash !== hash) return { ok: false, status: 422, error: "idempotency_key_reuse" };
          replayed = true;
          return JSON.parse(String(prior.response)) as ReserveResult;
        }
        const result = this.reserveInTransaction(actor, input, now);
        this.storeIdempotent(actor.employeeId, idempotencyKey, hash, result, now);
        return result;
      });
      if (committed.ok && !replayed) await this.afterCommit(changeOf("booked", committed.reservation, committed.ledgerVersion, committed.dateVersion));
      return committed;
    } catch (err) {
      if (!(err instanceof BackstopConflict)) throw err;
      // Everything above rolled back. Record the hit and the conflict as the keyed response.
      const result: ReserveResult = { ok: false, status: 409, error: err.table === "employee_slots" ? "employee_conflict" : "resource_conflict", conflicts: [] };
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("UPDATE meta SET value = CAST(value AS INTEGER) + 1 WHERE key = 'backstop_hits'");
        this.storeIdempotent(actor.employeeId, idempotencyKey, hash, result, now);
      });
      return result;
    }
  }

  /** Steps 2 to 7 of SPEC 7.1; runs inside reserve's transactionSync with no await. */
  private reserveInTransaction(actor: Actor, input: ReserveInput, now: number): ReserveResult {
    const res = this.sql.exec("SELECT id, kind, capacity, active FROM resources WHERE id = ?", input.resourceId).toArray()[0];
    if (!res) return { ok: false, status: 404, error: "resource_not_found" };
    const resource = { id: String(res.id), kind: res.kind as ResourceKind, capacity: Number(res.capacity), active: Number(res.active) === 1 };
    const issues = validate(input, resource, this.siteRules(), now);
    if (issues.length > 0) return { ok: false, status: 422, error: "validation", issues };

    const conflicts = this.sql
      .exec(
        `SELECT start_min AS startMin, end_min AS endMin FROM reservations
         WHERE resource_id = ? AND date = ? AND status = 'confirmed' AND start_min < ? AND end_min > ?
         ORDER BY start_min`,
        input.resourceId,
        input.date,
        input.endMin,
        input.startMin,
      )
      .toArray() as unknown as Interval[];
    if (conflicts.length > 0) return { ok: false, status: 409, error: "resource_conflict", conflicts };

    // One desk at a time per employee; one room at a time per organizer (I2, I3).
    const mine = this.sql
      .exec(
        `SELECT start_min AS startMin, end_min AS endMin FROM reservations
         WHERE employee_id = ? AND kind = ? AND date = ? AND status = 'confirmed' AND start_min < ? AND end_min > ?
         ORDER BY start_min`,
        actor.employeeId,
        resource.kind,
        input.date,
        input.endMin,
        input.startMin,
      )
      .toArray() as unknown as Interval[];
    if (mine.length > 0) return { ok: false, status: 409, error: "employee_conflict", conflicts: mine };

    const version = this.bumpLedgerVersion();
    const dateVersion = this.bumpDateVersion(input.date);
    const id = newId("rsv", now);
    const attendees = input.attendees ?? 1;
    const title = resource.kind === "room" && input.title ? input.title : null;
    this.sql.exec(
      `INSERT INTO reservations (id, resource_id, employee_id, kind, date, start_min, end_min, attendees, title, status, created_at, version)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
      id,
      input.resourceId,
      actor.employeeId,
      resource.kind,
      input.date,
      input.startMin,
      input.endMin,
      attendees,
      title,
      now,
      version,
    );
    // The PK backstop (ADR 0002): a duplicate slot throws, which rolls back the
    // reservation row and both version bumps with it.
    for (const slot of slotsFor(input.startMin, input.endMin)) {
      try {
        this.sql.exec("INSERT INTO resource_slots (resource_id, date, slot, reservation_id) VALUES (?, ?, ?, ?)", input.resourceId, input.date, slot, id);
      } catch (err) {
        throw new BackstopConflict("resource_slots", err instanceof Error ? err.message : String(err));
      }
      try {
        this.sql.exec(
          "INSERT INTO employee_slots (employee_id, kind, date, slot, reservation_id) VALUES (?, ?, ?, ?, ?)",
          actor.employeeId,
          resource.kind,
          input.date,
          slot,
          id,
        );
      } catch (err) {
        throw new BackstopConflict("employee_slots", err instanceof Error ? err.message : String(err));
      }
    }
    const row = this.sql.exec("SELECT * FROM reservations WHERE id = ?", id).one() as unknown as ReservationRow;
    this.enqueueFact(row, now);
    return { ok: true, status: 201, reservation: toReservation(row), ledgerVersion: version, dateVersion };
  }

  async cancel(actor: Actor, reservationId: string, reason?: string): Promise<CancelResult> {
    await this.ensureCatalog();
    const now = this.now();
    const result = this.ctx.storage.transactionSync((): CancelResult => {
      const row = this.sql.exec("SELECT * FROM reservations WHERE id = ?", reservationId).toArray()[0] as unknown as ReservationRow | undefined;
      if (!row) return { ok: false, status: 404, error: "reservation_not_found" };
      if (row.employee_id !== actor.employeeId && actor.role !== "facilities_admin") return { ok: false, status: 403, error: "not_owner" };
      if (row.status !== "confirmed") return { ok: false, status: 409, error: "not_confirmed" };
      if (hasStarted(row.date, row.start_min, this.siteRules(), now)) return { ok: false, status: 409, error: "already_started" };
      this.sql.exec("DELETE FROM resource_slots WHERE reservation_id = ?", reservationId);
      this.sql.exec("DELETE FROM employee_slots WHERE reservation_id = ?", reservationId);
      const version = this.bumpLedgerVersion();
      const dateVersion = this.bumpDateVersion(row.date);
      this.sql.exec(
        "UPDATE reservations SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, cancel_reason = ?, version = ? WHERE id = ?",
        now,
        actor.employeeId,
        reason?.slice(0, 200) ?? null,
        version,
        reservationId,
      );
      const updated = this.sql.exec("SELECT * FROM reservations WHERE id = ?", reservationId).one() as unknown as ReservationRow;
      this.enqueueFact(updated, now);
      return { ok: true, status: 200, reservation: toReservation(updated), ledgerVersion: version, dateVersion };
    });
    if (result.ok) await this.afterCommit(changeOf("released", result.reservation, result.ledgerVersion, result.dateVersion));
    return result;
  }

  /** Post-commit work for every mutation: live delta to that date's subscribers, then the D1 flush. */
  private async afterCommit(change: ReservationChange): Promise<void> {
    broadcastDelta(this.ctx.getWebSockets(), change, this.now());
    await this.scheduleFlush();
  }

  /** WebSocket upgrade only. The Worker authenticated the caller and set the actor header. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("expected a WebSocket upgrade", { status: 426 });
    let actor: LiveActor;
    try {
      actor = JSON.parse(request.headers.get(ACTOR_HEADER) ?? "") as LiveActor;
    } catch {
      return new Response("missing actor", { status: 400 });
    }
    if (!actor?.employeeId || !actor.role || typeof actor.exp !== "number") return new Response("missing actor", { status: 400 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    const attachment: LiveAttachment = { employeeId: actor.employeeId, role: actor.role, staff: false, exp: actor.exp, dates: [] };
    server.serializeAttachment(attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const att = attachmentOf(ws);
    if (!att) return;
    if (isExpired(att, this.now())) {
      closeExpired(ws);
      return;
    }
    let parsed;
    try {
      parsed = ClientMessage.safeParse(JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)));
    } catch {
      parsed = null;
    }
    if (!parsed?.success) {
      send(ws, { type: "error", code: "bad_message" });
      return;
    }
    const msg = parsed.data;
    switch (msg.type) {
      case "ping":
        send(ws, { type: "pong" });
        return;
      case "subscribe": {
        if (!att.dates.includes(msg.date)) {
          if (att.dates.length >= MAX_SUBSCRIBED_DATES) {
            send(ws, { type: "error", code: "too_many_dates" });
            return;
          }
          att.dates.push(msg.date);
          ws.serializeAttachment(att);
        }
        const snap = await this.availability(msg.date, undefined, att.employeeId);
        const snapshot: SnapshotMessage = { type: "snapshot", ...snap };
        send(ws, snapshot);
        return;
      }
      case "unsubscribe":
        att.dates = att.dates.filter((d) => d !== msg.date);
        ws.serializeAttachment(att);
        return;
      case "subscribe_staff":
        if (!isStaff(att.role)) {
          send(ws, { type: "error", code: "forbidden" });
          return;
        }
        att.staff = true;
        ws.serializeAttachment(att);
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "error");
    } catch {
      // Already closed.
    }
  }

  /** Sends a staff event to sockets that subscribed to staff events (called by the Workflow and the sweep). */
  notifyStaff(event: Omit<StaffEventMessage, "type">): { delivered: number } {
    return { delivered: broadcastStaff(this.ctx.getWebSockets(), event, this.now()) };
  }

  /**
   * Flushes up to 50 outbox rows to D1 in one batch. Errors are caught (never rethrown,
   * so the platform retry budget is unused) and drive our own backoff counter (m1).
   */
  async alarm(): Promise<void> {
    this.alarmPending = false;
    const now = Date.now();
    this.sql.exec("DELETE FROM idempotency WHERE created_at < ?", this.now() - IDEMPOTENCY_TTL_MS);
    const rows = this.sql.exec("SELECT seq, payload FROM outbox ORDER BY seq LIMIT ?", FLUSH_BATCH).toArray();
    if (rows.length === 0) return;
    const facts = rows.map((r) => JSON.parse(String(r.payload)) as FactPayload);
    const lastSeq = Number(rows[rows.length - 1]?.seq);
    try {
      const siteId = String(this.sql.exec("SELECT id FROM site LIMIT 1").toArray()[0]?.id ?? this.ctx.id.name ?? "");
      await this.env.DB.batch(projectionStatements(this.env.DB, siteId, facts, new Date(now).toISOString()));
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("DELETE FROM outbox WHERE seq <= ?", lastSeq);
        this.setMeta("flush_failures", 0);
        this.setMeta("last_flush_error", "");
      });
      if (this.outboxDepth() > 0) {
        await this.ctx.storage.setAlarm(Date.now());
        this.alarmPending = true;
      }
    } catch (err) {
      const failures = Number(this.meta("flush_failures")) + 1;
      this.setMeta("flush_failures", failures);
      this.setMeta("last_flush_error", err instanceof Error ? err.message : String(err));
      await this.ctx.storage.setAlarm(Date.now() + flushBackoffMs(failures));
      this.alarmPending = true;
    }
  }

  projectionStatus() {
    return {
      ledgerVersion: Number(this.meta("ledger_version")),
      outboxDepth: this.outboxDepth(),
      backstopHits: Number(this.meta("backstop_hits")),
      lastFlushError: this.meta("last_flush_error") || null,
      flushFailures: Number(this.meta("flush_failures")),
    };
  }

  /** Read-only busy intervals per resource for one date. */
  async availability(date: string, resourceIds?: string[], viewerId?: string) {
    await this.ensureCatalog();
    const ids = resourceIds ?? this.sql.exec("SELECT id FROM resources ORDER BY id").toArray().map((r) => String(r.id));
    const busy: Record<string, BusyInterval[]> = {};
    for (const id of ids) busy[id] = [];
    const rows = this.sql
      .exec("SELECT resource_id, employee_id, start_min, end_min FROM reservations WHERE date = ? AND status = 'confirmed' ORDER BY start_min", date)
      .toArray();
    for (const r of rows) {
      const list = busy[String(r.resource_id)];
      if (list) list.push({ startMin: Number(r.start_min), endMin: Number(r.end_min), mine: viewerId !== undefined && r.employee_id === viewerId });
    }
    return { date, dateVersion: this.dateVersion(date), ledgerVersion: Number(this.meta("ledger_version")), busy };
  }

  /** An employee's own bookings between two dates (inclusive), newest date last. */
  async reservationsFor(employeeId: string, fromDate: string, toDate: string, status?: "confirmed" | "cancelled"): Promise<Reservation[]> {
    const rows = this.sql
      .exec(
        `SELECT * FROM reservations WHERE employee_id = ? AND date BETWEEN ? AND ?${status ? " AND status = ?" : ""}
         ORDER BY date, start_min, resource_id`,
        employeeId,
        fromDate,
        toDate,
        ...(status ? [status] : []),
      )
      .toArray() as unknown as ReservationRow[];
    return rows.map(toReservation);
  }

  /** Seven days of busy intervals for one resource; only the viewer's own bookings carry an id. */
  async calendar(resourceId: string, weekStart: string, viewerId: string) {
    const days: { date: string; busy: { startMin: number; endMin: number; mine: boolean; reservationId?: string }[] }[] = [];
    for (let i = 0; i < 7; i++) days.push({ date: addDays(weekStart, i), busy: [] });
    const rows = this.sql
      .exec(
        `SELECT id, employee_id, date, start_min, end_min FROM reservations
         WHERE resource_id = ? AND status = 'confirmed' AND date BETWEEN ? AND ? ORDER BY date, start_min`,
        resourceId,
        weekStart,
        addDays(weekStart, 6),
      )
      .toArray();
    for (const r of rows) {
      const day = days.find((d) => d.date === r.date);
      if (!day) continue;
      const mine = r.employee_id === viewerId;
      day.busy.push({ startMin: Number(r.start_min), endMin: Number(r.end_min), mine, ...(mine ? { reservationId: String(r.id) } : {}) });
    }
    return { resourceId, weekStart, days };
  }

  /** Admin and eval: every confirmed reservation on a date. */
  exportDay(date: string): Reservation[] {
    const rows = this.sql
      .exec("SELECT * FROM reservations WHERE date = ? AND status = 'confirmed' ORDER BY resource_id, start_min", date)
      .toArray() as unknown as ReservationRow[];
    return rows.map(toReservation);
  }

  ledgerStats() {
    return {
      ledgerVersion: Number(this.meta("ledger_version")),
      backstopHits: Number(this.meta("backstop_hits")),
    };
  }

  dateVersions(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of this.sql.exec("SELECT date, version FROM date_versions ORDER BY date").toArray()) out[String(r.date)] = Number(r.version);
    return out;
  }

  /** Dev seed only: drops all ledger data, keeps the schema. */
  async resetForDev(): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      for (const t of DATA_TABLES) this.sql.exec(`DELETE FROM ${t}`);
      for (const [key, value] of Object.entries(META_DEFAULTS)) this.setMeta(key, value);
    });
    await this.ctx.storage.deleteAlarm();
    this.alarmPending = false;
  }
}
