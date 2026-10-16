import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { describe, expect, it, vi } from "vitest";
import { WorkSummary } from "../../../src/client/charts/WorkSummary.tsx";
import type { SummaryTile } from "../../../src/client/charts/work-summary.ts";
import { expectNoAxeViolations } from "../axe.ts";

const TILES: SummaryTile[] = [
  { id: "suggested", label: "Suggestions to review", count: 12, capped: false, oldestMinutes: 11 * 1440 + 30, basis: "submitted", overDay: 10, to: "/staff" },
  { id: "manual", label: "To categorize by hand", count: 1, capped: false, oldestMinutes: 45, basis: "submitted", overDay: 0, to: "/staff" },
  { id: "assigned", label: "Assigned, not started", count: 4, capped: false, oldestMinutes: 3 * 1440, basis: "status", overDay: null, to: "/staff?tab=working" },
  { id: "in_progress", label: "In progress", count: 200, capped: true, oldestMinutes: 90, basis: "status", overDay: null, to: "/staff?tab=working" },
];

function renderTiles(tiles: SummaryTile[], onActivate = vi.fn()) {
  const router = createMemoryRouter([{ path: "*", element: <WorkSummary tiles={tiles} onActivate={onActivate} /> }], { initialEntries: ["/staff"] });
  render(<RouterProvider router={router} />);
  return { router, onActivate };
}

describe("WorkSummary (VIZ-01)", () => {
  it("is a list named Work at a glance with one sentence per tile", async () => {
    renderTiles(TILES);
    const list = screen.getByRole("list", { name: "Work at a glance" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("aria-label"))).toEqual([
      "Suggestions to review: 12 requests, oldest 11 days, 10 waiting over 24 hours",
      "To categorize by hand: 1 request, oldest 45 minutes",
      "Assigned, not started: 4 requests, oldest 3 days in this status",
      "In progress: 200 or more requests, oldest 1 hour in this status",
    ]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/staff", "/staff", "/staff?tab=working", "/staff?tab=working"]);
    await expectNoAxeViolations();
  });

  it("shows the count, the oldest line and the over-24-h words with an icon, never color alone", () => {
    renderTiles(TILES);
    const first = screen.getByRole("link", { name: /^Suggestions to review/ });
    expect(first.textContent).toBe("Suggestions to review12oldest 11 d10 waiting over 24 h");
    const warn = within(first).getByText("10 waiting over 24 h");
    expect(warn.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.getByRole("link", { name: /^In progress/ }).textContent).toContain("200+");
    expect(screen.getByRole("link", { name: /^Assigned/ }).textContent).toContain("oldest 3 d in this status");
    // No warning where nothing is over a day.
    expect(screen.getByRole("link", { name: /^To categorize/ }).textContent).not.toContain("over 24");
  });

  it("all zero: no oldest lines, and a sentence saying nothing waits", () => {
    renderTiles(TILES.map((t) => ({ ...t, count: 0, capped: false, oldestMinutes: null, overDay: t.overDay === null ? null : 0 })));
    expect(screen.getAllByRole("link").map((l) => l.textContent)).toEqual(["Suggestions to review0", "To categorize by hand0", "Assigned, not started0", "In progress0"]);
    expect(screen.getByText("Nothing is waiting for staff.")).toBeTruthy();
  });

  it("navigates with replace and reports the tile", async () => {
    const { router, onActivate } = renderTiles(TILES);
    await userEvent.setup().click(screen.getByRole("link", { name: /^In progress/ }));
    expect(router.state.location.search).toBe("?tab=working");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({ id: "in_progress" }));
  });
});
