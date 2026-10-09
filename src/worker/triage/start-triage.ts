// startTriage (SPEC 7.3): create the Workflow instance with id = request id. An
// "already exists" error, or a follow-up get() that succeeds, counts as started. Any
// other error is logged and reported as false; the cron sweep retries later.

export interface TriageParams {
  requestId: string;
  siteId: string;
}

export type TriageWorkflowBinding = Pick<Workflow<TriageParams>, "create" | "get">;

export async function startTriage(env: Env, wf: TriageWorkflowBinding, requestId: string, siteId: string, nowMs: number): Promise<boolean> {
  const at = new Date(nowMs).toISOString();
  // Count the attempt and write triage_started before create(): a fast Workflow can
  // record `triaged` within milliseconds of create, and the timeline is ordered by event
  // id, so the event must already exist. Every attempt counts toward the sweep's hand-off
  // limit, successful or not; a failed create removes its triage_started event again.
  const [, inserted] = await env.DB.batch([
    env.DB.prepare("UPDATE facilities_requests SET triage_attempts = triage_attempts + 1, updated_at = ? WHERE id = ?").bind(at, requestId),
    env.DB.prepare("INSERT INTO request_events (request_id, type, actor_id, data, at) VALUES (?, 'triage_started', NULL, '{}', ?) RETURNING id").bind(requestId, at),
  ]);
  const eventId = (inserted?.results[0] as { id?: number } | undefined)?.id;
  let started = false;
  try {
    await wf.create({ id: requestId, params: { requestId, siteId } });
    started = true;
  } catch (err) {
    if (String(err instanceof Error ? err.message : err).includes("already_exists")) {
      started = true;
    } else {
      try {
        await wf.get(requestId);
        started = true;
      } catch {
        console.error("triage workflow create failed", requestId, err);
      }
    }
  }
  if (started) {
    await env.DB.prepare("UPDATE facilities_requests SET workflow_instance_id = ? WHERE id = ?").bind(requestId, requestId).run();
  } else if (eventId !== undefined) {
    await env.DB.prepare("DELETE FROM request_events WHERE id = ? AND type = 'triage_started'").bind(eventId).run();
  }
  return started;
}
