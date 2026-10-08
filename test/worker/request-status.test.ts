import { describe, expect, it } from "vitest";
import { REQUEST_ACTIONS, REQUEST_STATUSES, type RequestAction, type RequestStatus, nextStatus } from "../../src/shared/request-status.ts";

// The complete transition table: every (status, action) pair not listed is illegal.
const LEGAL: Record<string, RequestStatus> = {
  "submitted|triaged": "awaiting_review",
  "submitted|hand_off": "awaiting_review",
  "submitted|review": "assigned",
  "awaiting_review|review": "assigned",
  "assigned|start": "in_progress",
  "assigned|resolve": "resolved",
  "in_progress|resolve": "resolved",
  "submitted|cancel": "cancelled",
  "awaiting_review|cancel": "cancelled",
};

describe("nextStatus (exhaustive)", () => {
  const pairs: [RequestStatus, RequestAction][] = REQUEST_STATUSES.flatMap((s) => REQUEST_ACTIONS.map((a) => [s, a] as [RequestStatus, RequestAction]));
  it("covers all 36 pairs", () => {
    expect(pairs).toHaveLength(36);
  });
  it.each(pairs)("%s + %s", (status, action) => {
    expect(nextStatus(status, action)).toBe(LEGAL[`${status}|${action}`] ?? null);
  });
  it("resolved and cancelled are terminal", () => {
    for (const a of REQUEST_ACTIONS) {
      expect(nextStatus("resolved", a)).toBeNull();
      expect(nextStatus("cancelled", a)).toBeNull();
    }
  });
});
