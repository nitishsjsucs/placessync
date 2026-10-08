// Labels shared by the request pages and the dashboards.
import type { RequestEvent, RequestWithSuggestion } from "../../shared/api.ts";
import { REQUEST_STATUS_LABELS, type RequestStatus } from "../../shared/request-status.ts";
import { CATEGORY_LABELS, type Category } from "../../shared/triage/categories.ts";
import { providerLabel } from "../../shared/triage/provider-labels.ts";

export function categoryLabel(c: string | null | undefined): string {
  return c ? (CATEGORY_LABELS[c as Category] ?? c) : "Not set";
}

export function statusLabel(s: string): string {
  return REQUEST_STATUS_LABELS[s as RequestStatus] ?? s;
}

export function suggestionText(r: Pick<RequestWithSuggestion, "status" | "triageState" | "suggestion">): string {
  if (r.suggestion) {
    const base = `${categoryLabel(r.suggestion.category)} (${providerLabel(r.suggestion.provider)})`;
    return r.status === "awaiting_review" ? `${base}, awaiting staff review` : base;
  }
  if (r.triageState === "unavailable") return "No suggestion; staff will categorize it";
  return "Classification pending";
}

const HIDDEN_EVENTS = new Set(["triage_started", "review_observed"]);

export function timelineEvents(events: readonly RequestEvent[]): RequestEvent[] {
  return events.filter((e) => !HIDDEN_EVENTS.has(e.type));
}

export function eventLabel(e: RequestEvent): string {
  const d = e.data as Record<string, unknown>;
  switch (e.type) {
    case "submitted":
      return "Submitted";
    case "triage_retry":
      return "Automatic classification retried";
    case "triaged":
      return `Suggested category: ${categoryLabel(String(d.category ?? ""))} (${providerLabel(String(d.provider ?? ""))})`;
    case "triage_unavailable":
      return "Automatic classification unavailable; sent to staff to categorize";
    case "reviewed":
      return d.decision === "accept"
        ? "Reviewed by staff: suggestion accepted"
        : `Reviewed by staff: categorized as ${categoryLabel(String(d.category ?? ""))}`;
    case "review_overdue":
      return "Review overdue; staff were reminded";
    case "status_changed":
      return `Status changed to ${statusLabel(String(d.to ?? ""))}${d.note ? `: ${String(d.note)}` : ""}`;
    case "cancelled":
      return "Cancelled by the reporter";
    default:
      return e.type;
  }
}

export function formatWhen(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
}
