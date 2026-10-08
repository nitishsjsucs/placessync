// Cron safety net for triage (SPEC 7.3, ADR 0008). Every 2 minutes, requests still
// "submitted" after 2 minutes get a Workflow created or restarted; after 3 attempts, or
// when an instance finished without recording anything, they go to staff for manual
// categorization. No request can sit in "submitted" forever.
import type { Config } from "../config.ts";
import { ledgerFor } from "../ledger/ledger-for.ts";
import { eventStatement } from "../repo/requests.ts";
import { type TriageWorkflowBinding, startTriage } from "./start-triage.ts";

export const SWEEP_BATCH = 25;
export const STRANDED_AFTER_MS = 2 * 60_000;
export const MAX_TRIAGE_ATTEMPTS = 3;

const IN_FLIGHT = new Set(["queued", "running", "waiting", "paused", "waitingForPause", "rollingBack"]);

export interface SweepSummary {
  examined: number;
  created: number;
  restarted: number;
  handedOff: number;
  inFlight: number;
}

async function handOff(env: Env, config: Pick<Config, "siteId">, id: string, at: string, reason: string): Promise<boolean> {
  const [update] = await env.DB.batch([
    env.DB.prepare(
      "UPDATE facilities_requests SET status = 'awaiting_review', triage_state = 'unavailable', updated_at = ? WHERE id = ? AND status = 'submitted'",
    ).bind(at, id),
    env.DB.prepare(
      `INSERT INTO request_events (request_id, type, actor_id, data, at)
       SELECT ?, 'triage_unavailable', NULL, ?, ? WHERE EXISTS (SELECT 1 FROM facilities_requests WHERE id = ? AND triage_state = 'unavailable' AND updated_at = ?)`,
    ).bind(id, JSON.stringify({ reason }), at, id, at),
  ]);
  if (!update || update.meta.changes === 0) return false;
  try {
    await ledgerFor(env, config, config.siteId).notifyStaff({ event: "triage_unavailable", requestId: id });
  } catch {
    // Best effort: the staff queue shows the request either way.
  }
  return true;
}

export async function sweepStrandedRequests(
  env: Env,
  config: Pick<Config, "siteId">,
  nowMs: number,
  wf: TriageWorkflowBinding = env.TRIAGE_WORKFLOW,
): Promise<SweepSummary> {
  const summary: SweepSummary = { examined: 0, created: 0, restarted: 0, handedOff: 0, inFlight: 0 };
  const at = new Date(nowMs).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT id, site_id AS siteId, triage_attempts AS attempts FROM facilities_requests WHERE status = 'submitted' AND created_at < ? ORDER BY created_at LIMIT ?",
  )
    .bind(new Date(nowMs - STRANDED_AFTER_MS).toISOString(), SWEEP_BATCH)
    .all<{ id: string; siteId: string; attempts: number }>();

  for (const row of results) {
    summary.examined++;
    if (row.attempts >= MAX_TRIAGE_ATTEMPTS) {
      if (await handOff(env, config, row.id, at, "attempts_exhausted")) summary.handedOff++;
      continue;
    }
    let instance: WorkflowInstance;
    try {
      instance = await wf.get(row.id);
    } catch {
      // No instance (create failed after the insert, for example): let create decide.
      await startTriage(env, wf, row.id, row.siteId, nowMs);
      summary.created++;
      continue;
    }
    let status = "unknown";
    try {
      status = (await instance.status()).status;
    } catch {
      status = "unknown";
    }
    if (status === "errored" || status === "terminated") {
      try {
        await instance.restart();
        await env.DB.batch([
          env.DB.prepare("UPDATE facilities_requests SET triage_attempts = triage_attempts + 1, updated_at = ? WHERE id = ?").bind(at, row.id),
          eventStatement(env.DB, row.id, "triage_retry", null, { from: status }, at),
        ]);
        summary.restarted++;
      } catch (err) {
        console.error("triage restart failed", row.id, err);
        await env.DB.prepare("UPDATE facilities_requests SET triage_attempts = triage_attempts + 1, updated_at = ? WHERE id = ?").bind(at, row.id).run();
      }
    } else if (IN_FLIGHT.has(status)) {
      summary.inFlight++;
    } else {
      // complete or unknown while D1 still says submitted: it will never record anything.
      if (await handOff(env, config, row.id, at, `instance_${status}`)) summary.handedOff++;
    }
  }
  return summary;
}
