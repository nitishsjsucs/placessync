// D1 access for facilities requests, triage suggestions and the request event log.
import type { FacilitiesRequest, RequestEvent, RequestWithSuggestion, Suggestion } from "../../shared/api.ts";
import type { Category } from "../../shared/triage/categories.ts";

const REQUEST_COLUMNS = `
  r.id, r.site_id AS siteId, r.reporter_id AS reporterId, e.display_name AS reporterName,
  r.resource_id AS resourceId, res.name AS resourceName, r.location_note AS locationNote,
  r.title, r.description, r.status, r.triage_state AS triageState, r.triage_attempts AS triageAttempts,
  r.final_category AS finalCategory, r.review_decision AS reviewDecision, r.reviewed_by AS reviewedBy,
  r.reviewed_at AS reviewedAt, r.created_at AS createdAt, r.updated_at AS updatedAt`;

const SUGGESTION_COLUMNS = `
  s.category AS s_category, s.confidence AS s_confidence, s.rationale AS s_rationale, s.provider AS s_provider,
  s.model AS s_model, s.attempts AS s_attempts, s.latency_ms AS s_latencyMs, s.created_at AS s_createdAt`;

const FROM = `
  FROM facilities_requests r
  LEFT JOIN employees e ON e.id = r.reporter_id
  LEFT JOIN resources res ON res.id = r.resource_id
  LEFT JOIN triage_suggestions s ON s.request_id = r.id`;

type Row = FacilitiesRequest & {
  s_category: Category | null;
  s_confidence: number | null;
  s_rationale: string | null;
  s_provider: Suggestion["provider"] | null;
  s_model: string | null;
  s_attempts: number | null;
  s_latencyMs: number | null;
  s_createdAt: string | null;
};

function split(row: Row): RequestWithSuggestion {
  const { s_category, s_confidence, s_rationale, s_provider, s_model, s_attempts, s_latencyMs, s_createdAt, ...request } = row;
  const suggestion: Suggestion | null =
    s_category === null
      ? null
      : {
          category: s_category,
          confidence: s_confidence ?? 0,
          rationale: s_rationale ?? "",
          provider: s_provider ?? "stub",
          model: s_model ?? "",
          attempts: s_attempts ?? 0,
          latencyMs: s_latencyMs ?? 0,
          createdAt: s_createdAt ?? "",
        };
  return { ...request, suggestion };
}

export async function getRequestWithSuggestion(db: D1Database, id: string): Promise<RequestWithSuggestion | null> {
  const row = await db.prepare(`SELECT ${REQUEST_COLUMNS}, ${SUGGESTION_COLUMNS} ${FROM} WHERE r.id = ?`).bind(id).first<Row>();
  return row ? split(row) : null;
}

export async function listOwnRequests(db: D1Database, reporterId: string, status?: string): Promise<RequestWithSuggestion[]> {
  const { results } = await db
    .prepare(`SELECT ${REQUEST_COLUMNS}, ${SUGGESTION_COLUMNS} ${FROM} WHERE r.reporter_id = ?${status ? " AND r.status = ?" : ""} ORDER BY r.created_at DESC`)
    .bind(...[reporterId, ...(status ? [status] : [])])
    .all<Row>();
  return results.map(split);
}

/**
 * Staff queue. Without a status: everything awaiting review plus submitted rows older
 * than 2 minutes (classification pending). With a status: that status.
 */
export async function listStaffQueue(
  db: D1Database,
  siteId: string,
  opts: { status?: string; category?: string; q?: string; nowMs: number },
): Promise<(RequestWithSuggestion & { ageMinutes: number })[]> {
  const where: string[] = ["r.site_id = ?"];
  const binds: unknown[] = [siteId];
  if (opts.status) {
    where.push("r.status = ?");
    binds.push(opts.status);
  } else {
    where.push("(r.status = 'awaiting_review' OR (r.status = 'submitted' AND r.created_at < ?))");
    binds.push(new Date(opts.nowMs - 2 * 60_000).toISOString());
  }
  if (opts.category) {
    where.push("COALESCE(r.final_category, s.category) = ?");
    binds.push(opts.category);
  }
  if (opts.q) {
    where.push("(r.title LIKE ? OR r.description LIKE ? OR r.location_note LIKE ?)");
    const like = `%${opts.q.replace(/[%_]/g, "")}%`;
    binds.push(like, like, like);
  }
  const { results } = await db
    .prepare(`SELECT ${REQUEST_COLUMNS}, ${SUGGESTION_COLUMNS} ${FROM} WHERE ${where.join(" AND ")} ORDER BY r.created_at ASC LIMIT 200`)
    .bind(...binds)
    .all<Row>();
  return results.map((row) => {
    const r = split(row);
    return { ...r, ageMinutes: Math.max(0, Math.floor((opts.nowMs - Date.parse(r.createdAt)) / 60_000)) };
  });
}

export async function listEvents(db: D1Database, requestId: string): Promise<RequestEvent[]> {
  const { results } = await db
    .prepare("SELECT id, type, actor_id AS actorId, data, at FROM request_events WHERE request_id = ? ORDER BY id")
    .bind(requestId)
    .all<{ id: number; type: string; actorId: string | null; data: string; at: string }>();
  return results.map((e) => ({ ...e, data: JSON.parse(e.data || "{}") as Record<string, unknown> }));
}

export function eventStatement(db: D1Database, requestId: string, type: string, actorId: string | null, data: unknown, at: string): D1PreparedStatement {
  return db
    .prepare("INSERT INTO request_events (request_id, type, actor_id, data, at) VALUES (?, ?, ?, ?, ?)")
    .bind(requestId, type, actorId, JSON.stringify(data ?? {}), at);
}

export interface TriageSource {
  title: string;
  description: string;
  resourceName: string | null;
  locationNote: string;
  status: string;
}

export async function loadRequestForTriage(db: D1Database, id: string): Promise<TriageSource | null> {
  return db
    .prepare(
      `SELECT r.title, r.description, res.name AS resourceName, r.location_note AS locationNote, r.status
       FROM facilities_requests r LEFT JOIN resources res ON res.id = r.resource_id WHERE r.id = ?`,
    )
    .bind(id)
    .first<TriageSource>();
}
