// startTriage (SPEC 7.3): create the Workflow instance with id = request id. An
// "already exists" error, or a follow-up get() that succeeds, counts as started. Any
// other error is logged and reported as false; the cron sweep retries later.
import { eventStatement } from "../repo/requests.ts";

export interface TriageParams {
  requestId: string;
  siteId: string;
}

export type TriageWorkflowBinding = Pick<Workflow<TriageParams>, "create" | "get">;

export async function startTriage(env: Env, wf: TriageWorkflowBinding, requestId: string, siteId: string, nowMs: number): Promise<boolean> {
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
  const at = new Date(nowMs).toISOString();
  // Every create attempt counts toward the sweep's hand-off limit, successful or not.
  const stmts = [
    env.DB.prepare(
      "UPDATE facilities_requests SET triage_attempts = triage_attempts + 1, workflow_instance_id = CASE WHEN ? THEN ? ELSE workflow_instance_id END, updated_at = ? WHERE id = ?",
    ).bind(started ? 1 : 0, requestId, at, requestId),
  ];
  if (started) stmts.push(eventStatement(env.DB, requestId, "triage_started", null, {}, at));
  await env.DB.batch(stmts);
  return started;
}
