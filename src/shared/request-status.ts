// Facilities request status machine (SPEC 7.3, 8). Every status change in the API goes
// through nextStatus; anything it returns null for is an illegal transition (409).
export const REQUEST_STATUSES = ["submitted", "awaiting_review", "assigned", "in_progress", "resolved", "cancelled"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const REQUEST_ACTIONS = ["triaged", "hand_off", "review", "start", "resolve", "cancel"] as const;
export type RequestAction = (typeof REQUEST_ACTIONS)[number];

const TRANSITIONS: Record<RequestAction, Partial<Record<RequestStatus, RequestStatus>>> = {
  // The Workflow records a suggestion.
  triaged: { submitted: "awaiting_review" },
  // The sweep hands an untriageable request to staff.
  hand_off: { submitted: "awaiting_review" },
  // Staff accept, reassign or categorize.
  review: { submitted: "assigned", awaiting_review: "assigned" },
  start: { assigned: "in_progress" },
  resolve: { assigned: "resolved", in_progress: "resolved" },
  // The reporter withdraws a request nobody has picked up.
  cancel: { submitted: "cancelled", awaiting_review: "cancelled" },
};

export function nextStatus(current: RequestStatus, action: RequestAction): RequestStatus | null {
  return TRANSITIONS[action][current] ?? null;
}

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  submitted: "Submitted",
  awaiting_review: "Awaiting staff review",
  assigned: "Assigned",
  in_progress: "In progress",
  resolved: "Resolved",
  cancelled: "Cancelled",
};
