// Facilities staff routes (SPEC 7.3, 8): triage queue, conditional review, status
// changes. Reviews are conditional UPDATEs, so two staff members reviewing at once
// produce exactly one review.
import { Hono } from "hono";
import { ReviewBody, StaffQueueQuery, StatusChangeBody } from "../../shared/api.ts";
import { type RequestStatus, nextStatus } from "../../shared/request-status.ts";
import type { AppEnv } from "../app-env.ts";
import { requireRole } from "../auth/middleware.ts";
import { errorResponse, jsonBody, queryParams } from "../http.ts";
import { ledgerFor } from "../ledger/ledger-for.ts";
import { getRequestWithSuggestion, listStaffQueue } from "../repo/requests.ts";
import { REVIEW_EVENT } from "../triage/triage-workflow.ts";

export const staffRoutes = new Hono<AppEnv>()
  .use("/api/staff/*", requireRole("facilities_staff", "facilities_admin"))
  .get("/api/staff/requests", queryParams(StaffQueueQuery), async (c) => {
    const q = c.req.valid("query");
    const requests = await listStaffQueue(c.env.DB, c.get("config").siteId, { ...q, nowMs: c.get("deps").now() });
    return c.json({ requests });
  })
  .post("/api/staff/requests/:id/review", jsonBody(ReviewBody), async (c) => {
    const body = c.req.valid("json");
    const id = c.req.param("id");
    const reviewer = c.get("principal").employeeId;
    const deps = c.get("deps");
    const at = new Date(deps.now()).toISOString();
    const db = c.env.DB;
    let update: D1PreparedStatement;
    if (body.decision === "accept") {
      update = db
        .prepare(
          `UPDATE facilities_requests SET status = 'assigned', final_category = (SELECT category FROM triage_suggestions WHERE request_id = ?1),
             review_decision = 'accepted', reviewed_by = ?2, reviewed_at = ?3, updated_at = ?3
           WHERE id = ?1 AND status = 'awaiting_review' AND triage_state = 'suggested' AND EXISTS (SELECT 1 FROM triage_suggestions WHERE request_id = ?1)`,
        )
        .bind(id, reviewer, at);
    } else if (body.decision === "reassign") {
      update = db
        .prepare(
          `UPDATE facilities_requests SET status = 'assigned', final_category = ?4, review_decision = 'reassigned', reviewed_by = ?2, reviewed_at = ?3, updated_at = ?3
           WHERE id = ?1 AND status = 'awaiting_review' AND triage_state = 'suggested' AND EXISTS (SELECT 1 FROM triage_suggestions WHERE request_id = ?1)`,
        )
        .bind(id, reviewer, at, body.category);
    } else {
      // Manual categorization: no suggestion was shown (pending or unavailable triage).
      update = db
        .prepare(
          `UPDATE facilities_requests SET status = 'assigned', final_category = ?4, review_decision = 'manual', reviewed_by = ?2, reviewed_at = ?3, updated_at = ?3
           WHERE id = ?1 AND status IN ('submitted', 'awaiting_review') AND triage_state IN ('pending', 'unavailable')`,
        )
        .bind(id, reviewer, at, body.category);
    }
    const [result] = await db.batch([
      update,
      // Written only if this review's UPDATE took effect; the partial unique index
      // ux_one_review_event makes a second reviewed event impossible regardless.
      db
        .prepare(
          `INSERT OR IGNORE INTO request_events (request_id, type, actor_id, data, at)
           SELECT ?1, 'reviewed', ?2, ?4, ?3 WHERE EXISTS (SELECT 1 FROM facilities_requests WHERE id = ?1 AND reviewed_by = ?2 AND reviewed_at = ?3)`,
        )
        .bind(id, reviewer, at, JSON.stringify(body)),
    ]);
    if (!result || result.meta.changes === 0) {
      return errorResponse(c, 409, "not_reviewable", "This request was already reviewed, was cancelled, or does not take that decision.");
    }
    try {
      const instance = await deps.triageWorkflow(c.env).get(id);
      await instance.sendEvent({ type: REVIEW_EVENT, payload: { outcome: "reviewed", at } });
    } catch {
      // Best effort: the workflow's timer re-reads D1.
    }
    await notifyUpdated(c.env, c.get("config"), id);
    return c.json({ request: await getRequestWithSuggestion(db, id) });
  })
  .post("/api/staff/requests/:id/status", jsonBody(StatusChangeBody), async (c) => {
    const { status: target, note } = c.req.valid("json");
    const id = c.req.param("id");
    const found = await getRequestWithSuggestion(c.env.DB, id);
    if (!found) return errorResponse(c, 404, "request_not_found", "No such request.");
    const action = target === "in_progress" ? "start" : "resolve";
    const current = found.status as RequestStatus;
    if (nextStatus(current, action) !== target) {
      return errorResponse(c, 409, "invalid_transition", `Cannot move a ${current} request to ${target}.`);
    }
    const at = new Date(c.get("deps").now()).toISOString();
    const [update] = await c.env.DB.batch([
      c.env.DB.prepare("UPDATE facilities_requests SET status = ?, updated_at = ? WHERE id = ? AND status = ?").bind(target, at, id, current),
      c.env.DB.prepare(
        `INSERT INTO request_events (request_id, type, actor_id, data, at)
         SELECT ?, 'status_changed', ?, ?, ? WHERE EXISTS (SELECT 1 FROM facilities_requests WHERE id = ? AND status = ? AND updated_at = ?)`,
      ).bind(id, c.get("principal").employeeId, JSON.stringify({ from: current, to: target, note: note ?? null }), at, id, target, at),
    ]);
    if (!update || update.meta.changes === 0) return errorResponse(c, 409, "invalid_transition", "The request changed meanwhile; reload and try again.");
    await notifyUpdated(c.env, c.get("config"), id);
    return c.json({ request: await getRequestWithSuggestion(c.env.DB, id) });
  });

async function notifyUpdated(env: Env, config: { siteId: string }, requestId: string): Promise<void> {
  try {
    await ledgerFor(env, config, config.siteId).notifyStaff({ event: "request_updated", requestId });
  } catch {
    // Live updates are best effort.
  }
}
