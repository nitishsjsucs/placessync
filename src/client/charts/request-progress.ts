// Where a facilities request is (VIZ-03): five steps from submission to resolution, each
// done with its time, the current one with who acts next and how long it has waited, and
// the rest not yet. Built from the request, its suggestion and its event log, which
// GET /api/requests/:id already returns to the reporter and to staff. Pure, so every mix
// of status and events is tested without rendering.
import type { FacilitiesRequest, RequestEvent, Suggestion } from "../../shared/api.ts";
import { providerLabel } from "../../shared/triage/provider-labels.ts";
import { categoryLabel, statusLabel } from "../pages/requests-ui.ts";

export const STEP_COUNT = 5;

export type StepKey = "submitted" | "categorized" | "reviewed" | "started" | "resolved" | "cancelled";
export type StepState = "done" | "current" | "future" | "skipped" | "cancelled";

export interface ProgressStep {
  key: StepKey;
  label: string;
  state: StepState;
  /** When the step happened (ISO), when known. */
  at: string | null;
  /** Minutes since the previous step that has a time, for done and cancelled steps. */
  afterMinutes: number | null;
  detail: string | null;
  /** The current step only: who acts next and for how long it has waited so far. */
  now: { who: string; sinceMinutes: number; overdue: boolean } | null;
}

type OpenStatus = "submitted" | "awaiting_review" | "assigned" | "in_progress";

/** Who acts next, by status. */
export const NOW_TEXT: Record<OpenStatus, string> = {
  submitted: "being categorized automatically",
  awaiting_review: "waiting for facilities staff to review",
  assigned: "waiting for staff to start work",
  in_progress: "staff are working on it",
};

/** The step a request in this status is on (1-based), or null once it is closed. */
export function stepNumber(status: string): number | null {
  const n = { submitted: 2, awaiting_review: 3, assigned: 4, in_progress: 5 }[status];
  return n ?? null;
}

/** "Assigned, step 4 of 5", "Resolved", "Cancelled": the My requests status cell. */
export function statusStepText(status: string): string {
  const n = stepNumber(status);
  return n === null ? statusLabel(status) : `${statusLabel(status)}, step ${n} of ${STEP_COUNT}`;
}

const LABELS: Record<Exclude<StepKey, "cancelled">, string> = {
  submitted: "Submitted",
  categorized: "Categorized",
  reviewed: "Reviewed by staff",
  started: "Work started",
  resolved: "Resolved",
};

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Number.NaN);
const minutesBetween = (from: number, to: number) => Math.max(0, Math.floor((to - from) / 60_000));

function reviewedDetail(e: RequestEvent | undefined, finalCategory: string | null): string | null {
  const d = (e?.data ?? {}) as Record<string, unknown>;
  const category = categoryLabel(finalCategory ?? (typeof d.category === "string" ? d.category : null));
  if (d.decision === "accept") return `Kept the suggestion: ${category}`;
  if (d.decision === "reassign") return `Changed to ${category}`;
  if (d.decision === "categorize") return `Categorized as ${category}`;
  return finalCategory ? `Final category: ${category}` : null;
}

export function progressSteps(request: FacilitiesRequest, suggestion: Suggestion | null, events: readonly RequestEvent[], nowMs: number): ProgressStep[] {
  const find = (type: string, pred: (e: RequestEvent) => boolean = () => true) => events.find((e) => e.type === type && pred(e));
  const submitted = find("submitted");
  const triaged = find("triaged");
  const handedOff = find("triage_unavailable");
  const reviewed = find("reviewed");
  const startedEv = find("status_changed", (e) => e.data.to === "in_progress");
  const resolvedEv = find("status_changed", (e) => e.data.to === "resolved");
  const cancelledEv = find("cancelled");
  const overdueEv = find("review_overdue");
  const status = request.status;

  // Step 2 follows what staff were shown: a suggestion, a hand-off, or (while still
  // submitted) a staff member categorizing it by hand. A late suggestion on a request
  // already handed off or categorized is stored but was never the categorization.
  let categorized: { at: string | null; detail: string | null } | null = null;
  if (request.triageState === "suggested") {
    const d = (triaged?.data ?? {}) as Record<string, unknown>;
    const category = typeof d.category === "string" ? d.category : (suggestion?.category ?? null);
    const provider = typeof d.provider === "string" ? d.provider : (suggestion?.provider ?? null);
    categorized = {
      at: triaged?.at ?? (Number.isFinite(ms(suggestion?.createdAt)) ? (suggestion?.createdAt ?? null) : null),
      detail: category ? `Suggested ${categoryLabel(category)}${provider ? ` (${providerLabel(provider)})` : ""}` : null,
    };
  } else if (request.triageState === "unavailable") {
    categorized = { at: handedOff?.at ?? null, detail: "Sent to staff to categorize" };
  } else if (reviewed) {
    categorized = { at: reviewed.at, detail: "Categorized by staff" };
  }

  const facts: Record<Exclude<StepKey, "cancelled">, { at: string | null; detail: string | null }> = {
    submitted: { at: submitted?.at ?? request.createdAt, detail: null },
    categorized: categorized ?? { at: null, detail: null },
    reviewed: { at: reviewed?.at ?? request.reviewedAt, detail: reviewedDetail(reviewed, request.finalCategory) },
    started: { at: startedEv?.at ?? null, detail: null },
    resolved: { at: resolvedEv?.at ?? null, detail: typeof resolvedEv?.data.note === "string" && resolvedEv.data.note ? `Staff note: ${resolvedEv.data.note}` : null },
  };
  const order = ["submitted", "categorized", "reviewed", "started", "resolved"] as const;
  const skippedStart = resolvedEv?.data.from === "assigned" && !startedEv;

  // How far the request got: steps before `current` are done.
  let current: number;
  if (status === "cancelled") current = categorized ? 2 : 1;
  else if (status === "resolved") current = order.length;
  else current = (stepNumber(status) ?? 1) - 1;

  const steps: ProgressStep[] = [];
  for (let i = 0; i < order.length; i++) {
    const key = order[i] as (typeof order)[number];
    const fact = facts[key];
    const base = { key, label: LABELS[key], at: null, afterMinutes: null, detail: null, now: null };
    if (i < current) {
      if (key === "started" && skippedStart) steps.push({ ...base, state: "skipped" });
      else steps.push({ ...base, state: "done", at: fact.at, detail: fact.detail });
    } else if (status === "cancelled") {
      steps.push({ ...base, key: "cancelled", label: "Cancelled", state: "cancelled", at: cancelledEv?.at ?? request.updatedAt });
      break;
    } else if (i === current) {
      steps.push({ ...base, state: "current" });
    } else {
      steps.push({ ...base, state: "future" });
    }
  }

  // "after" runs from the previous step that has a time; "so far" from the last one.
  let last = Number.NaN;
  for (const s of steps) {
    if (s.state === "done" || s.state === "cancelled") {
      const t = ms(s.at);
      if (!Number.isFinite(t)) continue;
      if (Number.isFinite(last)) s.afterMinutes = minutesBetween(last, t);
      last = t;
    } else if (s.state === "current") {
      s.now = {
        who: NOW_TEXT[status as OpenStatus] ?? statusLabel(status),
        sinceMinutes: Number.isFinite(last) ? minutesBetween(last, nowMs) : 0,
        overdue: status === "awaiting_review" && overdueEv !== undefined,
      };
    }
  }
  return steps;
}
