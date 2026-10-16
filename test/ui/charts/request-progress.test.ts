import { describe, expect, it } from "vitest";
import type { FacilitiesRequest, RequestEvent, Suggestion } from "../../../src/shared/api.ts";
import { type ProgressStep, progressSteps, statusStepText, stepNumber } from "../../../src/client/charts/request-progress.ts";
import { elapsed } from "../../../src/client/pages/requests-ui.ts";

const T = (minutes: number) => new Date(Date.parse("2026-10-08T15:00:00.000Z") + minutes * 60_000).toISOString();
const NOW = Date.parse(T(0)) + 3 * 1440 * 60_000;

function request(over: Partial<FacilitiesRequest>): FacilitiesRequest {
  return {
    id: "req_p",
    siteId: "hq",
    reporterId: "emp_001",
    reporterName: "Test Person",
    resourceId: null,
    resourceName: null,
    locationNote: "",
    title: "Projector dead",
    description: "The projector in Sequoia shows no signal.",
    status: "submitted",
    triageState: "pending",
    triageAttempts: 1,
    finalCategory: null,
    reviewDecision: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: T(0),
    updatedAt: T(0),
    ...over,
  };
}
let nextId = 1;
const ev = (type: string, at: number, data: Record<string, unknown> = {}): RequestEvent => ({ id: nextId++, type, actorId: null, data, at: T(at) });
const suggestion = (provider: Suggestion["provider"], category: Suggestion["category"] = "electrical_av"): Suggestion => ({
  category,
  confidence: 0.8,
  rationale: "Projector is AV.",
  provider,
  model: "m",
  attempts: 1,
  latencyMs: 5,
  createdAt: T(1),
});
const summary = (steps: ProgressStep[]) => steps.map((s) => [s.label, s.state, s.afterMinutes, s.detail]);

describe("progressSteps (VIZ-03)", () => {
  it("submitted only: step 2 is current, being categorized automatically", () => {
    const steps = progressSteps(request({}), null, [ev("submitted", 0)], Date.parse(T(5)));
    expect(summary(steps)).toEqual([
      ["Submitted", "done", null, null],
      ["Categorized", "current", null, null],
      ["Reviewed by staff", "future", null, null],
      ["Work started", "future", null, null],
      ["Resolved", "future", null, null],
    ]);
    expect(steps[1]?.now).toEqual({ who: "being categorized automatically", sinceMinutes: 5, overdue: false });
  });

  it("triaged: the suggestion with its provider label, never AI for the stub or the fallback", () => {
    for (const [provider, label] of [
      ["stub", "Keyword stub (keyword-v1)"],
      ["keyword-fallback", "Keyword fallback"],
      ["workers-ai", "Workers AI"],
    ] as const) {
      const steps = progressSteps(
        request({ status: "awaiting_review", triageState: "suggested" }),
        suggestion(provider),
        [ev("submitted", 0), ev("triaged", 1, { category: "electrical_av", provider })],
        Date.parse(T(61)),
      );
      expect(steps[1]).toMatchObject({ state: "done", at: T(1), afterMinutes: 1, detail: `Suggested Electrical and AV (${label})` });
      expect(steps[2]).toMatchObject({ state: "current", now: { who: "waiting for facilities staff to review", sinceMinutes: 60, overdue: false } });
    }
  });

  it("triage unavailable: sent to staff to categorize, even when a late suggestion arrived", () => {
    const steps = progressSteps(
      request({ status: "awaiting_review", triageState: "unavailable" }),
      suggestion("stub"),
      [ev("submitted", 0), ev("triage_unavailable", 30), ev("triaged", 40, { category: "electrical_av", provider: "stub" })],
      NOW,
    );
    expect(steps[1]).toMatchObject({ state: "done", at: T(30), afterMinutes: 30, detail: "Sent to staff to categorize" });
  });

  it("categorized by hand while still submitted: step 2 is Categorized by staff at the review", () => {
    const steps = progressSteps(
      request({ status: "assigned", triageState: "pending", finalCategory: "cleaning_safety", reviewDecision: "manual" }),
      null,
      [ev("submitted", 0), ev("reviewed", 3, { decision: "categorize", category: "cleaning_safety" })],
      NOW,
    );
    expect(summary(steps).slice(0, 4)).toEqual([
      ["Submitted", "done", null, null],
      ["Categorized", "done", 3, "Categorized by staff"],
      ["Reviewed by staff", "done", 0, "Categorized as Cleaning and safety"],
      ["Work started", "current", null, null],
    ]);
    expect(steps[3]?.now?.who).toBe("waiting for staff to start work");
  });

  it("reviewed: accept keeps the suggestion, reassign names the new category", () => {
    const base = [ev("submitted", 0), ev("triaged", 1, { category: "electrical_av", provider: "stub" })];
    const accepted = progressSteps(request({ status: "assigned", triageState: "suggested", finalCategory: "electrical_av" }), suggestion("stub"), [...base, ev("reviewed", 61, { decision: "accept" })], NOW);
    expect(accepted[2]).toMatchObject({ state: "done", afterMinutes: 60, detail: "Kept the suggestion: Electrical and AV" });
    const reassigned = progressSteps(
      request({ status: "assigned", triageState: "suggested", finalCategory: "furniture_fixtures" }),
      suggestion("stub"),
      [...base, ev("reviewed", 61, { decision: "reassign", category: "furniture_fixtures" })],
      NOW,
    );
    expect(reassigned[2]?.detail).toBe("Changed to Furniture and fixtures");
  });

  it("in progress then resolved, with the staff note", () => {
    const events = [
      ev("submitted", 0),
      ev("triaged", 1, { category: "electrical_av", provider: "stub" }),
      ev("reviewed", 61, { decision: "accept" }),
      ev("status_changed", 121, { from: "assigned", to: "in_progress", note: null }),
    ];
    const working = progressSteps(request({ status: "in_progress", triageState: "suggested", finalCategory: "electrical_av" }), suggestion("stub"), events, Date.parse(T(121 + 4 * 1440 + 16 * 60)));
    expect(working.map((s) => s.state)).toEqual(["done", "done", "done", "done", "current"]);
    expect(working[3]).toMatchObject({ at: T(121), afterMinutes: 60 });
    expect(working[4]?.now).toEqual({ who: "staff are working on it", sinceMinutes: 4 * 1440 + 16 * 60, overdue: false });
    expect(elapsed(working[4]!.now!.sinceMinutes)).toBe("4 d 16 h");

    const resolved = progressSteps(
      request({ status: "resolved", triageState: "suggested", finalCategory: "electrical_av" }),
      suggestion("stub"),
      [...events, ev("status_changed", 200, { from: "in_progress", to: "resolved", note: "Replaced the HDMI cable" })],
      NOW,
    );
    expect(resolved.map((s) => s.state)).toEqual(["done", "done", "done", "done", "done"]);
    expect(resolved[4]).toMatchObject({ at: T(200), afterMinutes: 79, detail: "Staff note: Replaced the HDMI cable" });
    expect(resolved.some((s) => s.now)).toBe(false);
  });

  it("resolved straight from assigned: Work started is Skipped", () => {
    const steps = progressSteps(
      request({ status: "resolved", triageState: "suggested", finalCategory: "electrical_av" }),
      suggestion("stub"),
      [ev("submitted", 0), ev("triaged", 1, { category: "electrical_av", provider: "stub" }), ev("reviewed", 61, { decision: "accept" }), ev("status_changed", 90, { from: "assigned", to: "resolved", note: null })],
      NOW,
    );
    expect(summary(steps).slice(3)).toEqual([
      ["Work started", "skipped", null, null],
      // "after" runs from the review, the last step with a time.
      ["Resolved", "done", 29, null],
    ]);
  });

  it("cancelled from submitted or from awaiting review: one terminal Cancelled step, no future steps", () => {
    const fromSubmitted = progressSteps(request({ status: "cancelled", triageState: "pending" }), null, [ev("submitted", 0), ev("cancelled", 2)], NOW);
    expect(summary(fromSubmitted)).toEqual([
      ["Submitted", "done", null, null],
      ["Cancelled", "cancelled", 2, null],
    ]);
    const fromReview = progressSteps(
      request({ status: "cancelled", triageState: "suggested" }),
      suggestion("stub"),
      [ev("submitted", 0), ev("triaged", 1, { category: "electrical_av", provider: "stub" }), ev("cancelled", 31)],
      NOW,
    );
    expect(summary(fromReview)).toEqual([
      ["Submitted", "done", null, null],
      ["Categorized", "done", 1, "Suggested Electrical and AV (Keyword stub (keyword-v1))"],
      ["Cancelled", "cancelled", 30, null],
    ]);
  });

  it("review overdue: the current step says so while the request waits for review", () => {
    const events = [ev("submitted", 0), ev("triaged", 1, { category: "electrical_av", provider: "stub" }), ev("review_overdue", 1441)];
    const waiting = progressSteps(request({ status: "awaiting_review", triageState: "suggested" }), suggestion("stub"), events, NOW);
    expect(waiting[2]?.now?.overdue).toBe(true);
    const reviewed = progressSteps(request({ status: "assigned", triageState: "suggested", finalCategory: "electrical_av" }), suggestion("stub"), [...events, ev("reviewed", 1500, { decision: "accept" })], NOW);
    expect(reviewed.find((s) => s.state === "current")?.now?.overdue).toBe(false);
  });

  it("a clock behind the server's gives 0 so far, not a negative time", () => {
    const steps = progressSteps(request({}), null, [ev("submitted", 0)], Date.parse(T(-30)));
    expect(steps[1]?.now?.sinceMinutes).toBe(0);
  });
});

describe("elapsed and the status step text", () => {
  it("formats minutes, hours and days at their boundaries", () => {
    expect([elapsed(0), elapsed(59), elapsed(60), elapsed(784), elapsed(2879), elapsed(2880), elapsed(6720), elapsed(-5)]).toEqual([
      "0 min",
      "59 min",
      "1 h",
      "13 h 4 min",
      "47 h 59 min",
      "2 d",
      "4 d 16 h",
      "0 min",
    ]);
  });

  it("names the step for each open status and none for closed ones", () => {
    expect(["submitted", "awaiting_review", "assigned", "in_progress", "resolved", "cancelled"].map((s) => [stepNumber(s), statusStepText(s)])).toEqual([
      [2, "Submitted, step 2 of 5"],
      [3, "Awaiting staff review, step 3 of 5"],
      [4, "Assigned, step 4 of 5"],
      [5, "In progress, step 5 of 5"],
      [null, "Resolved"],
      [null, "Cancelled"],
    ]);
  });
});
