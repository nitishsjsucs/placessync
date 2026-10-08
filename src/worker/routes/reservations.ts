// Reservation routes (SPEC 8). The Worker validates types and resolves the site from the
// D1 resource row (404 before any Durable Object call); the ledger applies the rules.
import { Hono } from "hono";
import { CancelBody, ReservationsQuery, ReserveBody, type ReserveResponse } from "../../shared/api.ts";
import type { AppEnv } from "../app-env.ts";
import { ApiError, errorResponse, jsonBody, queryParams } from "../http.ts";
import { ledgerFor } from "../ledger/ledger-for.ts";
import { findResource } from "../repo/catalog.ts";

const MESSAGES: Record<string, string> = {
  resource_conflict: "That time overlaps an existing booking.",
  employee_conflict: "You already hold a booking of this kind at that time.",
  validation: "The booking breaks a booking rule.",
  idempotency_key_reuse: "This Idempotency-Key was already used for a different request.",
  resource_not_found: "No such resource.",
  reservation_not_found: "No such reservation.",
  not_owner: "Only the person who booked it, or a facilities admin, can cancel this.",
  not_confirmed: "This booking is not active.",
  already_started: "This booking has already started.",
};

export const reservationRoutes = new Hono<AppEnv>()
  .post("/api/reservations", jsonBody(ReserveBody), async (c) => {
    const key = c.req.header("idempotency-key") ?? "";
    if (key.length < 8 || key.length > 64) {
      return errorResponse(c, 422, "validation", "Send an Idempotency-Key header of 8 to 64 characters.", {
        issues: [{ path: "Idempotency-Key", code: "idempotency_key", message: "8 to 64 characters" }],
      });
    }
    const input = c.req.valid("json");
    const resource = await findResource(c.env.DB, input.resourceId);
    if (!resource) throw new ApiError(404, "resource_not_found", MESSAGES.resource_not_found as string);
    const principal = c.get("principal");
    const result = await ledgerFor(c.env, c.get("config"), resource.siteId).reserve(
      { employeeId: principal.employeeId, role: principal.role },
      input,
      key,
    );
    if (result.ok) {
      const body: ReserveResponse = { reservation: result.reservation, version: result.ledgerVersion, dateVersion: result.dateVersion };
      return c.json(body, 201);
    }
    const { ok: _ok, status, error, ...details } = result;
    return errorResponse(c, status, error, MESSAGES[error] ?? error, details);
  })
  .get("/api/reservations", queryParams(ReservationsQuery), async (c) => {
    const q = c.req.valid("query");
    const principal = c.get("principal");
    if (q.employeeId && q.employeeId !== principal.employeeId && principal.role !== "facilities_admin") {
      return errorResponse(c, 403, "forbidden", "Only facilities admins can list another employee's bookings.");
    }
    const config = c.get("config");
    const reservations = await ledgerFor(c.env, config, config.siteId).reservationsFor(q.employeeId ?? principal.employeeId, q.from, q.to, q.status);
    return c.json({ reservations });
  })
  .post("/api/reservations/:id/cancel", jsonBody(CancelBody), async (c) => {
    const { reason } = c.req.valid("json");
    const principal = c.get("principal");
    const config = c.get("config");
    const result = await ledgerFor(c.env, config, config.siteId).cancel(
      { employeeId: principal.employeeId, role: principal.role },
      c.req.param("id"),
      reason,
    );
    if (result.ok) return c.json({ reservation: result.reservation, version: result.ledgerVersion, dateVersion: result.dateVersion });
    return errorResponse(c, result.status, result.error, MESSAGES[result.error] ?? result.error);
  });
