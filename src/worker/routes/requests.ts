// Facilities requests for every employee (SPEC 7.3, 8): report an issue, list and view
// your own requests, cancel one nobody has picked up yet.
import { Hono } from "hono";
import { CreateRequestBody, type CreateRequestResponse, MyRequestsQuery, type RequestDetailResponse } from "../../shared/api.ts";
import { isStaff } from "../../shared/roles.ts";
import type { AppEnv } from "../app-env.ts";
import { ApiError, errorResponse, jsonBody, queryParams } from "../http.ts";
import { findResource } from "../repo/catalog.ts";
import { eventStatement, getRequestWithSuggestion, listEvents, listOwnRequests } from "../repo/requests.ts";
import { startTriage } from "../triage/start-triage.ts";
import { REVIEW_EVENT } from "../triage/triage-workflow.ts";

export const requestRoutes = new Hono<AppEnv>()
  .post("/api/requests", jsonBody(CreateRequestBody), async (c) => {
    const body = c.req.valid("json");
    const config = c.get("config");
    const deps = c.get("deps");
    if (body.siteId !== config.siteId) {
      return errorResponse(c, 422, "validation", "Unknown site.", { issues: [{ path: "siteId", code: "unknown_site", message: "Unknown site." }] });
    }
    if (body.resourceId) {
      const resource = await findResource(c.env.DB, body.resourceId);
      if (!resource || resource.siteId !== body.siteId) {
        return errorResponse(c, 422, "validation", "Unknown resource for this site.", {
          issues: [{ path: "resourceId", code: "unknown_resource", message: "Pick a resource at this site." }],
        });
      }
    }
    const reporter = c.get("principal").employeeId;
    const id = deps.newId("req");
    const at = new Date(deps.now()).toISOString();
    // 1. The commit point: the request exists even if starting triage fails.
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO facilities_requests (id, site_id, reporter_id, resource_id, location_note, title, description, status, triage_state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'submitted', 'pending', ?, ?)`,
      ).bind(id, body.siteId, reporter, body.resourceId ?? null, body.locationNote ?? "", body.title, body.description, at, at),
      eventStatement(c.env.DB, id, "submitted", reporter, {}, at),
    ]);
    // 2. Start the Workflow; failure leaves the row submitted for the sweep.
    const started = await startTriage(c.env, deps.triageWorkflow(c.env), id, body.siteId, deps.now());
    const request = await getRequestWithSuggestion(c.env.DB, id);
    if (!request) throw new ApiError(500, "internal", "The request was not stored.");
    const { suggestion: _s, ...plain } = request;
    const res: CreateRequestResponse = { request: plain, triage: started ? "started" : "pending" };
    return c.json(res, 201);
  })
  .get("/api/requests", queryParams(MyRequestsQuery), async (c) => {
    const { status } = c.req.valid("query");
    return c.json({ requests: await listOwnRequests(c.env.DB, c.get("principal").employeeId, status) });
  })
  .get("/api/requests/:id", async (c) => {
    const p = c.get("principal");
    const found = await getRequestWithSuggestion(c.env.DB, c.req.param("id"));
    // Non-owners who are not staff learn nothing, not even that the id exists.
    if (!found || (found.reporterId !== p.employeeId && !isStaff(p.role))) {
      return errorResponse(c, 404, "request_not_found", "No such request.");
    }
    const { suggestion, ...request } = found;
    const body: RequestDetailResponse = { request, suggestion, events: await listEvents(c.env.DB, found.id) };
    return c.json(body);
  })
  .post("/api/requests/:id/cancel", async (c) => {
    const p = c.get("principal");
    const deps = c.get("deps");
    const id = c.req.param("id");
    const found = await getRequestWithSuggestion(c.env.DB, id);
    if (!found || found.reporterId !== p.employeeId) return errorResponse(c, 404, "request_not_found", "No such request.");
    const at = new Date(deps.now()).toISOString();
    const [update] = await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE facilities_requests SET status = 'cancelled', updated_at = ? WHERE id = ? AND reporter_id = ? AND status IN ('submitted', 'awaiting_review')",
      ).bind(at, id, p.employeeId),
      c.env.DB.prepare(
        `INSERT INTO request_events (request_id, type, actor_id, data, at)
         SELECT ?, 'cancelled', ?, '{}', ? WHERE EXISTS (SELECT 1 FROM facilities_requests WHERE id = ? AND status = 'cancelled' AND updated_at = ?)`,
      ).bind(id, p.employeeId, at, id, at),
    ]);
    if (!update || update.meta.changes === 0) return errorResponse(c, 409, "not_cancellable", "Only a request that nobody has picked up can be cancelled.");
    try {
      const instance = await deps.triageWorkflow(c.env).get(id);
      await instance.sendEvent({ type: REVIEW_EVENT, payload: { outcome: "cancelled", at } });
    } catch {
      // Best effort: the workflow re-reads D1 when its review timer fires.
    }
    const updated = await getRequestWithSuggestion(c.env.DB, id);
    return c.json({ request: updated });
  });
