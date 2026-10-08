// TriageWorkflow (SPEC 7.3, ADR 0006): load the request, classify it into one of four
// categories, record the suggestion, notify staff, then wait up to 24 hours for the
// review and flag it as overdue if none arrives. Staff decisions live in D1; this
// workflow never decides anything on its own.
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import { classifyRequest } from "../../shared/triage/classify.ts";
import { classifyByKeywords } from "../../shared/triage/keyword-classifier.ts";
import { renderRequest } from "../../shared/triage/prompt.ts";
import type { Category } from "../../shared/triage/categories.ts";
import { parseConfig } from "../config.ts";
import { ledgerFor } from "../ledger/ledger-for.ts";
import { eventStatement, loadRequestForTriage } from "../repo/requests.ts";
import { createTriageProvider } from "./provider-factory.ts";
import type { TriageParams } from "./start-triage.ts";

export interface SuggestionRecord {
  category: Category;
  confidence: number;
  rationale: string;
  provider: "workers-ai" | "openai-compat" | "stub" | "keyword-fallback";
  model: string;
  latencyMs: number;
  attempts: number;
}

export interface ReviewOutcomePayload {
  outcome: "reviewed" | "cancelled";
  at: string;
}

export const REVIEW_EVENT = "review_outcome";

function minutesBetween(fromIso: string | null | undefined, toMs: number): number | null {
  if (!fromIso) return null;
  return Math.max(0, Math.round((toMs - Date.parse(fromIso)) / 60_000));
}

export class TriageWorkflow extends WorkflowEntrypoint<Env, TriageParams> {
  async run(event: Readonly<WorkflowEvent<TriageParams>>, step: WorkflowStep): Promise<TriageOutcome> {
    return runTriage(this.env, event.payload, step);
  }
}

export interface TriageOutcome {
  recorded: boolean;
  outcome: string;
}

/** The workflow body, separate from the entrypoint class so it can also run with a fake step. */
export async function runTriage(env: Env, params: TriageParams, step: WorkflowStep): Promise<TriageOutcome> {
  {
    const { requestId, siteId } = params;
    const parsed = parseConfig(env as unknown as Record<string, unknown>);
    if (!parsed.ok) throw new NonRetryableError(`misconfigured: ${parsed.issues.join("; ")}`);
    const config = parsed.config;
    const db = env.DB;

    const source = await step.do("load-request", { retries: { limit: 3, delay: "1 second", backoff: "exponential" } }, async () => {
      const row = await loadRequestForTriage(db, requestId);
      if (!row) throw new NonRetryableError(`request ${requestId} not found`);
      return { title: row.title, description: row.description, resourceName: row.resourceName, locationNote: row.locationNote };
    });

    // The keyword classifier always returns one of the four categories. It runs when the
    // provider is unavailable (for example workers-ai without an AI binding) or when
    // classify exhausts its retries, and is recorded as keyword-fallback.
    const fallback = () =>
      step.do("classify-fallback", async (): Promise<SuggestionRecord> => {
        const k = classifyByKeywords(renderRequest(source));
        return { category: k.category, confidence: k.confidence, rationale: k.rationale, provider: "keyword-fallback", model: "keyword-v1", latencyMs: 0, attempts: 1 };
      });

    const choice = createTriageProvider(env, config);
    let suggestion: SuggestionRecord;
    if (choice.status !== "ready") {
      suggestion = await fallback();
    } else {
      try {
        suggestion = await step.do(
          "classify",
          { retries: { limit: 2, delay: "2 seconds", backoff: "exponential" }, timeout: "60 seconds" },
          async (ctx): Promise<SuggestionRecord> => {
            const c = await classifyRequest(choice.provider, source);
            return { category: c.category, confidence: c.confidence, rationale: c.rationale, provider: c.provider, model: c.model, latencyMs: c.latencyMs, attempts: ctx.attempt };
          },
        );
      } catch {
        suggestion = await fallback();
      }
    }

    const recorded = await step.do("record-suggestion", async () => {
      const at = new Date().toISOString();
      await db.batch([
        db
          .prepare(
            `INSERT INTO triage_suggestions (request_id, category, confidence, rationale, provider, model, attempts, latency_ms, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(request_id) DO NOTHING`,
          )
          .bind(requestId, suggestion.category, suggestion.confidence, suggestion.rationale, suggestion.provider, suggestion.model, suggestion.attempts, suggestion.latencyMs, at),
        db
          .prepare("UPDATE facilities_requests SET status = 'awaiting_review', triage_state = 'suggested', updated_at = ? WHERE id = ? AND status = 'submitted'")
          .bind(at, requestId),
        db
          .prepare(
            `INSERT INTO request_events (request_id, type, actor_id, data, at)
             SELECT ?, 'triaged', NULL, ?, ? WHERE NOT EXISTS (SELECT 1 FROM request_events WHERE request_id = ? AND type = 'triaged')`,
          )
          .bind(requestId, JSON.stringify({ category: suggestion.category, provider: suggestion.provider }), at, requestId),
      ]);
      // Idempotent check of the outcome: did this suggestion put the request in front of staff?
      const row = await db
        .prepare("SELECT status, triage_state AS triageState FROM facilities_requests WHERE id = ?")
        .bind(requestId)
        .first<{ status: string; triageState: string }>();
      return { recorded: row?.status === "awaiting_review" && row.triageState === "suggested" };
    });

    if (!recorded.recorded) {
      // Staff categorized it by hand or the reporter cancelled it first: no stale alert.
      return { recorded: false, outcome: "superseded" };
    }

    try {
      await step.do("notify-staff", { retries: { limit: 2, delay: "1 second" } }, async () => {
        const { delivered } = await ledgerFor(env, config, siteId).notifyStaff({ event: "triage_ready", requestId, category: suggestion.category });
        return { delivered };
      });
    } catch {
      // Best effort: the staff queue still shows the request.
    }

    let outcome: ReviewOutcomePayload | null = null;
    try {
      const ev = await step.waitForEvent<ReviewOutcomePayload>("review-outcome", { type: REVIEW_EVENT, timeout: "24 hours" });
      outcome = ev.payload as ReviewOutcomePayload;
    } catch {
      outcome = null;
    }

    if (outcome) {
      await step.do("record-review-latency", async () => {
        const triaged = await db.prepare("SELECT at FROM request_events WHERE request_id = ? AND type = 'triaged'").bind(requestId).first<{ at: string }>();
        const at = new Date().toISOString();
        await eventStatement(db, requestId, "review_observed", null, { outcome: outcome.outcome, minutes: minutesBetween(triaged?.at, Date.parse(outcome.at) || Date.now()) }, at).run();
      });
      return { recorded: true, outcome: outcome.outcome };
    }

    // Timeout. Re-read D1 first: the review may have happened with its event lost.
    const flagged = await step.do("flag-overdue", async () => {
      const row = await db
        .prepare("SELECT status, reviewed_at AS reviewedAt FROM facilities_requests WHERE id = ?")
        .bind(requestId)
        .first<{ status: string; reviewedAt: string | null }>();
      const at = new Date().toISOString();
      if (row?.status === "awaiting_review") {
        await eventStatement(db, requestId, "review_overdue", null, {}, at).run();
        try {
          await ledgerFor(env, config, siteId).notifyStaff({ event: "triage_overdue", requestId, category: suggestion.category });
        } catch {
          // Best effort.
        }
        return true;
      }
      const triaged = await db.prepare("SELECT at FROM request_events WHERE request_id = ? AND type = 'triaged'").bind(requestId).first<{ at: string }>();
      const reviewedMs = row?.reviewedAt ? Date.parse(row.reviewedAt) : Date.now();
      await eventStatement(db, requestId, "review_observed", null, { outcome: row?.status === "cancelled" ? "cancelled" : "reviewed", minutes: minutesBetween(triaged?.at, reviewedMs), viaTimeout: true }, at).run();
      return false;
    });
    return { recorded: true, outcome: flagged ? "overdue" : "observed" };
  }
}
