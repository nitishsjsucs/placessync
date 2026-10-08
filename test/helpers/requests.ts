import { env } from "cloudflare:workers";

let n = 0;

/** Inserts a facilities request row directly (no Workflow), returning its id. */
export async function insertRequest(opts: {
  id?: string;
  status?: string;
  triageState?: string;
  triageAttempts?: number;
  ageMinutes?: number;
  reporterId?: string;
  title?: string;
  description?: string;
}): Promise<string> {
  const id = opts.id ?? `req_t${Date.now().toString(36)}${(++n).toString(36)}`;
  const at = new Date(Date.now() - (opts.ageMinutes ?? 0) * 60_000).toISOString();
  await env.DB.prepare(
    `INSERT INTO facilities_requests (id, site_id, reporter_id, location_note, title, description, status, triage_state, triage_attempts, created_at, updated_at)
     VALUES (?, 'hq', ?, '', ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      opts.reporterId ?? "emp_001",
      opts.title ?? "Projector flickers",
      opts.description ?? "The projector in Sequoia flickers and then shows no signal.",
      opts.status ?? "submitted",
      opts.triageState ?? "pending",
      opts.triageAttempts ?? 0,
      at,
      at,
    )
    .run();
  return id;
}

export async function requestRow(id: string) {
  return env.DB.prepare("SELECT * FROM facilities_requests WHERE id = ?").bind(id).first<Record<string, unknown>>();
}

export async function eventTypes(id: string): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT type FROM request_events WHERE request_id = ? ORDER BY id").bind(id).all<{ type: string }>();
  return results.map((r) => r.type);
}

export async function suggestionRow(id: string) {
  return env.DB.prepare("SELECT * FROM triage_suggestions WHERE request_id = ?").bind(id).first<Record<string, unknown>>();
}
