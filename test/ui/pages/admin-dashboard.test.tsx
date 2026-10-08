import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEALTH, installFakeApi, me } from "../fake-api.ts";
import { renderAt } from "../render-app.tsx";

beforeEach(() => {
  installFakeApi({
    "GET /api/health": HEALTH,
    "GET /api/me": me("emp_100", "facilities_admin"),
    "GET /api/admin/reports/utilization": {
      from: "2026-09-10",
      to: "2026-10-22",
      kind: null,
      rows: [
        { resourceId: "res_2a01", kind: "desk", name: "Desk 2A-01", date: "2026-10-12", bookings: 2, bookedMin: 240, utilization: 0.3333 },
        { resourceId: "res_redwood", kind: "room", name: "Redwood", date: "2026-10-12", bookings: 1, bookedMin: 30, utilization: 0.0417 },
      ],
      hourly: [
        { date: "2026-10-12", resourceKind: "desk", hour: 9, occupied: 2 },
        { date: "2026-10-13", resourceKind: "desk", hour: 9, occupied: 1 },
        { date: "2026-10-12", resourceKind: "room", hour: 10, occupied: 1 },
      ],
      daily: [
        { date: "2026-10-12", resourceKind: "desk", confirmed: 2, cancelled: 0 },
        { date: "2026-10-13", resourceKind: "room", confirmed: 1, cancelled: 1 },
      ],
      totals: { bookings: 3, bookedMin: 270, resourceDays: 2, openMinutesPerDay: 720 },
    },
    "GET /api/admin/reports/requests": {
      from: "2026-09-10",
      to: "2026-10-22",
      categories: [
        { category: "electrical_av", status: "assigned", n: 4 },
        { category: "(unreviewed)", status: "awaiting_review", n: 2 },
      ],
      agreement: [
        { provider: "keyword-fallback", reviewed: 2, agreed: 1, agreementRate: 0.5 },
        { provider: "openai-compat", reviewed: 5, agreed: 4, agreementRate: 0.8 },
        { provider: "stub", reviewed: 10, agreed: 9, agreementRate: 0.9 },
        { provider: "workers-ai", reviewed: 3, agreed: 3, agreementRate: 1 },
      ],
      medianMinutesToReview: 42.5,
      reviewedCount: 20,
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("Admin dashboard (SPEC 14.1)", () => {
  it("renders the utilization table from the API", async () => {
    renderAt("/admin");
    await screen.findByText("Desk 2A-01");
    const table = screen.getByRole("table", { name: /^Utilization/ });
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows).toEqual([
      ["Desk 2A-01", "2026-10-12", "2", "4.0", "33%"],
      ["Redwood", "2026-10-12", "1", "0.5", "4%"],
    ]);
    expect(screen.getByText(/3 confirmed bookings, 5 booked hours across 2 resource-days/)).toBeTruthy();
  });

  it("renders hourly occupancy averages and bookings per day (Tier 2)", async () => {
    renderAt("/admin");
    await screen.findByText("Desk 2A-01");
    const hourly = screen.getByRole("table", { name: "Hourly occupancy: average desks and rooms in use" });
    const nine = within(hourly).getByText("09:00").closest("tr") as HTMLElement;
    expect(within(nine).getAllByRole("cell").map((c) => c.textContent)).toEqual(["09:00", "1.5", "0"]);
    const daily = screen.getByRole("table", { name: "Bookings per day" });
    expect(within(daily).getAllByRole("row")).toHaveLength(3);
  });

  it("shows agreement per provider with each provider's own label, and AI only for Workers AI", async () => {
    renderAt("/admin");
    await screen.findByText("Desk 2A-01");
    await userEvent.setup().click(screen.getByRole("tab", { name: "Requests" }));
    const table = await screen.findByRole("table", { name: "Suggestion agreement by provider" });
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows).toEqual([
      ["Keyword fallback agreement", "2", "1", "50%"],
      ["Local Qwen3-1.7B (llama.cpp) agreement", "5", "4", "80%"],
      ["Keyword stub (keyword-v1) agreement", "10", "9", "90%"],
      ["Workers AI agreement", "3", "3", "100%"],
    ]);
    for (const r of rows) {
      if (!String(r[0]).startsWith("Workers AI")) expect(r.join(" ")).not.toMatch(/\bAI\b/);
    }
    expect(screen.getByText(/Median time to review: 42.5 minutes \(20 reviewed\)/)).toBeTruthy();
    expect(screen.getByRole("table", { name: "Requests by category and status" })).toBeTruthy();
  });
});
