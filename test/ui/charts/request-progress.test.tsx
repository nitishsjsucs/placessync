import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RequestProgress } from "../../../src/client/charts/RequestProgress.tsx";
import type { FacilitiesRequest, RequestEvent } from "../../../src/shared/api.ts";
import { expectNoAxeViolations } from "../axe.ts";

const T0 = Date.parse("2026-10-08T15:00:00.000Z");
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();
const request: FacilitiesRequest = {
  id: "req_seed_039",
  siteId: "hq",
  reporterId: "emp_001",
  reporterName: "Test Person",
  resourceId: null,
  resourceName: null,
  locationNote: "",
  title: "Projector dead",
  description: "The projector in Sequoia shows no signal.",
  status: "in_progress",
  triageState: "suggested",
  triageAttempts: 1,
  finalCategory: "electrical_av",
  reviewDecision: "accepted",
  reviewedBy: "emp_093",
  reviewedAt: at(61),
  createdAt: at(0),
  updatedAt: at(121),
};
const events: RequestEvent[] = [
  { id: 1, type: "submitted", actorId: "emp_001", data: {}, at: at(0) },
  { id: 2, type: "triaged", actorId: null, data: { category: "electrical_av", provider: "stub" }, at: at(1) },
  { id: 3, type: "reviewed", actorId: "emp_093", data: { decision: "accept" }, at: at(61) },
  { id: 4, type: "status_changed", actorId: "emp_093", data: { from: "assigned", to: "in_progress", note: null }, at: at(121) },
];

afterEach(() => vi.useRealTimers());

describe("RequestProgress (VIZ-03)", () => {
  it("is an ordered list named Progress with exactly one current step, every state in words", async () => {
    vi.useFakeTimers({ now: T0 + (121 + 59) * 60_000 });
    render(<RequestProgress request={request} suggestion={null} events={events} />);
    const list = screen.getByRole("list", { name: "Progress" });
    expect(list.tagName).toBe("OL");
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("aria-current"))).toEqual([null, null, null, null, "step"]);
    expect(items.map((li) => li.textContent)).toEqual([
      `SubmittedDone, ${new Date(at(0)).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`,
      `CategorizedDone, ${new Date(at(1)).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}after 1 minSuggested Electrical and AV (Keyword stub (keyword-v1))`,
      `Reviewed by staffDone, ${new Date(at(61)).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}after 1 hKept the suggestion: Electrical and AV`,
      `Work startedDone, ${new Date(at(121)).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}after 1 h`,
      "ResolvedNow: staff are working on it, 59 min so far",
    ]);
    expect(list.textContent).not.toMatch(/\bAI\b/);
    vi.useRealTimers();
    await expectNoAxeViolations();
  });

  it("moves the so-far time once a minute without any request", async () => {
    vi.useFakeTimers({ now: T0 + (121 + 59) * 60_000 });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    render(<RequestProgress request={request} suggestion={null} events={events} />);
    expect(screen.getByText("Now: staff are working on it, 59 min so far")).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Now: staff are working on it, 1 h so far")).toBeTruthy();
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Now: staff are working on it, 1 h 1 min so far")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("says Not yet, Skipped and Cancelled in words", () => {
    const { unmount } = render(<RequestProgress request={{ ...request, status: "submitted", triageState: "pending" }} suggestion={null} events={events.slice(0, 1)} />);
    expect(screen.getAllByText("Not yet")).toHaveLength(3);
    unmount();
    const skipped = render(
      <RequestProgress
        request={{ ...request, status: "resolved" }}
        suggestion={null}
        events={[...events.slice(0, 3), { id: 5, type: "status_changed", actorId: "emp_093", data: { from: "assigned", to: "resolved", note: "Fixed it" }, at: at(90) }]}
      />,
    );
    expect(screen.getByText("Skipped")).toBeTruthy();
    expect(screen.getByText("Staff note: Fixed it")).toBeTruthy();
    expect(screen.queryByRole("listitem", { current: "step" })).toBeNull();
    skipped.unmount();
    render(<RequestProgress request={{ ...request, status: "cancelled", triageState: "pending" }} suggestion={null} events={[events[0]!, { id: 9, type: "cancelled", actorId: "emp_001", data: {}, at: at(3) }]} />);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[1]?.textContent).toMatch(/^CancelledBy the reporter, .*after 3 min$/);
  });

  it("shows the overdue words and icon on the current step", () => {
    render(
      <RequestProgress
        request={{ ...request, status: "awaiting_review", finalCategory: null }}
        suggestion={null}
        events={[...events.slice(0, 2), { id: 7, type: "review_overdue", actorId: null, data: {}, at: at(1441) }]}
      />,
    );
    const current = screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-current") === "step") as HTMLElement;
    const warn = within(current).getByText("Review overdue; staff were reminded");
    expect(warn.querySelector("svg[aria-hidden=true]")).toBeTruthy();
  });
});
