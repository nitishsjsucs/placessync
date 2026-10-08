import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HEALTH, installFakeApi, me } from "../fake-api.ts";
import { renderAt } from "../render-app.tsx";

const base = {
  siteId: "hq",
  reporterId: "emp_001",
  reporterName: "Test Person",
  resourceId: null,
  resourceName: null,
  locationNote: "",
  description: "Something is wrong near my desk this morning.",
  triageAttempts: 1,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: "2026-10-08T15:00:00.000Z",
  updatedAt: "2026-10-08T15:00:00.000Z",
};
const suggestion = (provider: string, category = "electrical_av") => ({ category, confidence: 0.8, rationale: "Projector is AV.", provider, model: "m", attempts: 1, latencyMs: 5, createdAt: "x" });

const REQUESTS = [
  { ...base, id: "req_a", title: "Projector dead", status: "awaiting_review", triageState: "suggested", finalCategory: null, reviewDecision: null, suggestion: suggestion("stub") },
  { ...base, id: "req_b", title: "Chair broken", status: "assigned", triageState: "suggested", finalCategory: "furniture_fixtures", reviewDecision: "reassigned", suggestion: suggestion("openai-compat", "cleaning_safety") },
  { ...base, id: "req_c", title: "Trash full", status: "submitted", triageState: "pending", finalCategory: null, reviewDecision: null, suggestion: null },
  { ...base, id: "req_d", title: "Leak fixed", status: "resolved", triageState: "suggested", finalCategory: "building_systems", reviewDecision: "accepted", suggestion: suggestion("keyword-fallback", "building_systems") },
];

afterEach(() => vi.unstubAllGlobals());

describe("My requests and request detail (SPEC 14.1)", () => {
  it("lists own requests with status, suggestion and provider label, and final category", async () => {
    installFakeApi({ "GET /api/health": HEALTH, "GET /api/me": me("emp_001", "employee"), "GET /api/requests": { requests: REQUESTS } });
    renderAt("/requests");
    await screen.findByRole("link", { name: "Projector dead" });
    const table = screen.getByRole("table", { name: "Open requests" });
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell").slice(0, 4).map((c) => c.textContent));
    expect(rows).toEqual([
      ["Projector dead", "Awaiting staff review", "Electrical and AV (Keyword stub (keyword-v1)), awaiting staff review", "Not reviewed yet"],
      ["Chair broken", "Assigned", "Cleaning and safety (Local Qwen3-1.7B (llama.cpp))", "Furniture and fixtures"],
      ["Trash full", "Submitted", "Classification pending", "Not reviewed yet"],
    ]);
    await userEvent.setup().click(screen.getByRole("tab", { name: "Closed" }));
    const closed = screen.getByRole("table", { name: "Closed requests" });
    expect(within(closed).getByText("Building systems (Keyword fallback)")).toBeTruthy();
    expect(screen.queryByText(/\bAI\b/)).toBeNull();
  });

  it("renders the event timeline in order on the detail page", async () => {
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/requests/req_b": {
        request: (({ suggestion: _s, ...r }) => r)(REQUESTS[1]!),
        suggestion: suggestion("openai-compat", "cleaning_safety"),
        events: [
          { id: 1, type: "submitted", actorId: "emp_001", data: {}, at: "2026-10-08T15:00:00.000Z" },
          { id: 2, type: "triage_started", actorId: null, data: {}, at: "2026-10-08T15:00:01.000Z" },
          { id: 3, type: "triaged", actorId: null, data: { category: "cleaning_safety", provider: "openai-compat" }, at: "2026-10-08T15:00:05.000Z" },
          { id: 4, type: "reviewed", actorId: "emp_093", data: { decision: "reassign", category: "furniture_fixtures" }, at: "2026-10-08T15:30:00.000Z" },
          { id: 5, type: "review_observed", actorId: null, data: {}, at: "2026-10-08T15:30:01.000Z" },
          { id: 6, type: "status_changed", actorId: "emp_093", data: { from: "assigned", to: "in_progress" }, at: "2026-10-08T16:00:00.000Z" },
        ],
      },
    });
    renderAt("/requests/req_b");
    const timeline = await screen.findByRole("list", { name: "Request timeline" });
    expect(within(timeline).getAllByRole("listitem").map((li) => li.querySelector("strong")?.textContent)).toEqual([
      "Submitted",
      "Suggested category: Cleaning and safety (Local Qwen3-1.7B (llama.cpp))",
      "Reviewed by staff: categorized as Furniture and fixtures",
      "Status changed to In progress",
    ]);
    expect(screen.getByText("Furniture and fixtures")).toBeTruthy();
  });

  it("shows triage_unavailable in the timeline", async () => {
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/requests/req_c": {
        request: { ...(({ suggestion: _s, ...r }) => r)(REQUESTS[2]!), status: "awaiting_review", triageState: "unavailable" },
        suggestion: null,
        events: [
          { id: 1, type: "submitted", actorId: "emp_001", data: {}, at: "2026-10-08T15:00:00.000Z" },
          { id: 2, type: "triage_unavailable", actorId: null, data: {}, at: "2026-10-08T15:08:00.000Z" },
        ],
      },
    });
    renderAt("/requests/req_c");
    expect(await screen.findByText("Automatic classification unavailable; sent to staff to categorize")).toBeTruthy();
    expect(screen.getByText("No suggestion; staff will categorize it")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel this request" })).toBeTruthy();
  });
});
