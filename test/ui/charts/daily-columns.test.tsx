import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DailyColumns, columnText, columnsSummary } from "../../../src/client/charts/DailyColumns.tsx";
import type { UtilizationReport } from "../../../src/shared/api.ts";
import { expectNoAxeViolations } from "../axe.ts";

const TODAY = "2026-10-16"; // a Friday
const RANGE = { from: "2026-10-05", to: "2026-10-20" }; // Mon 5th to Tue 20th: 12 weekdays
const REPORT: UtilizationReport = {
  from: RANGE.from,
  to: RANGE.to,
  kind: null,
  rows: [],
  hourly: [],
  daily: [
    { date: "2026-10-06", resourceKind: "desk", confirmed: 12, cancelled: 1 },
    { date: "2026-10-13", resourceKind: "desk", confirmed: 31, cancelled: 2 },
    { date: "2026-10-13", resourceKind: "room", confirmed: 5, cancelled: 0 },
    { date: "2026-10-19", resourceKind: "desk", confirmed: 9, cancelled: 0 },
    { date: "2026-10-20", resourceKind: "room", confirmed: 2, cancelled: 1 },
  ],
  totals: { bookings: 0, bookedMin: 0, resourceDays: 0, openMinutesPerDay: 720 },
};
const slots = (kind: "desk" | "room") => [...screen.getByTestId(`columns-${kind}`).querySelectorAll<HTMLElement>("[data-date]")];
const height = (el: HTMLElement) => (el.querySelector("[style]") as HTMLElement | null)?.style.height ?? "none";

describe("DailyColumns (VIZ-07)", () => {
  it("draws a column per weekday, zero-filled, weekends left out, on one shared y scale", () => {
    render(<DailyColumns report={REPORT} range={RANGE} today={TODAY} />);
    const desk = slots("desk");
    expect(desk.map((s) => s.dataset.date)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20"]);
    // 31 is the highest of both kinds, so a room's 5 is 5/31 of the height, like a desk's 5 would be.
    expect(height(desk[6]!)).toBe("100%");
    expect(height(desk[1]!)).toBe(`${(12 / 31) * 100}%`);
    expect(height(desk[0]!)).toBe("none");
    expect(height(slots("room")[6]!)).toBe(`${(5 / 31) * 100}%`);
    // One labelled max tick for the shared scale.
    expect(screen.getAllByText("31")).toHaveLength(2);
  });

  it("marks each Monday on the axis and splits the days at today under a label", () => {
    render(<DailyColumns report={REPORT} range={RANGE} today={TODAY} />);
    const desk = slots("desk");
    expect(desk.filter((s) => s.textContent?.match(/^Oct \d+$/)).map((s) => s.textContent)).toEqual(["Oct 5", "Oct 12", "Oct 19"]);
    const plot = screen.getByTestId("columns-desk");
    expect(within(plot).getByText("Today, booked so far")).toBeTruthy();
    // Columns before today are the primary color, from today on the context color.
    expect(desk[6]!.querySelector("[style]")?.className).not.toMatch(/ahead/);
    expect(desk[10]!.querySelector("[style]")?.className).toMatch(/ahead/);
  });

  it("is one tab stop per chart with a summary sentence; arrows, Home and End move a focused column and its text", () => {
    render(<DailyColumns report={REPORT} range={RANGE} today={TODAY} />);
    const plot = screen.getByRole("img", { name: "Desk bookings per weekday, October 5 to October 20; highest 31 on October 13; today is October 16" });
    expect(plot.tabIndex).toBe(0);
    expect(screen.getByRole("img", { name: /^Room bookings per weekday, October 5 to October 20; highest 5 on October 13;/ })).toBeTruthy();
    act(() => plot.focus());
    const live = () => plot.closest("figure")?.querySelector("[aria-live]")?.textContent;
    // Focus starts on the last day before today.
    expect(live()).toBe("Thursday, October 15: 0 desk bookings, 0 cancelled");
    fireEvent.keyDown(plot, { key: "Home" });
    expect(live()).toBe("Monday, October 5: 0 desk bookings, 0 cancelled");
    fireEvent.keyDown(plot, { key: "ArrowRight" });
    expect(live()).toBe("Tuesday, October 6: 12 desk bookings, 1 cancelled");
    expect(within(plot).getByText("Tuesday, October 6: 12 desk bookings, 1 cancelled")).toBeTruthy();
    fireEvent.keyDown(plot, { key: "End" });
    expect(live()).toBe("Tuesday, October 20: 0 desk bookings so far, 0 cancelled");
    fireEvent.keyDown(plot, { key: "ArrowLeft" });
    expect(live()).toBe("Monday, October 19: 9 desk bookings so far, 0 cancelled");
    expect(within(plot).queryAllByRole("button")).toEqual([]);
  });

  it("Show table reveals the same columns: every weekday for both kinds, zeros included, and which days are not over", () => {
    render(<DailyColumns report={REPORT} range={RANGE} today={TODAY} />);
    const toggle = screen.getByRole("button", { name: "Show table: bookings per day" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const table = screen.getByRole("table", { name: "Bookings per day" });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Date", "Kind", "Confirmed", "Cancelled", "Day over"]);
    const rows = within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    // 12 weekdays, desks then rooms for each, as the two charts draw them.
    expect(rows).toHaveLength(24);
    expect(rows.slice(0, 4)).toEqual([
      ["2026-10-05", "Desks", "0", "0", "Yes"],
      ["2026-10-05", "Rooms", "0", "0", "Yes"],
      ["2026-10-06", "Desks", "12", "1", "Yes"],
      ["2026-10-06", "Rooms", "0", "0", "Yes"],
    ]);
    expect(rows.slice(16)).toEqual([
      ["2026-10-15", "Desks", "0", "0", "Yes"],
      ["2026-10-15", "Rooms", "0", "0", "Yes"],
      ["2026-10-16", "Desks", "0", "0", "No, booked so far"],
      ["2026-10-16", "Rooms", "0", "0", "No, booked so far"],
      ["2026-10-19", "Desks", "9", "0", "No, booked so far"],
      ["2026-10-19", "Rooms", "0", "0", "No, booked so far"],
      ["2026-10-20", "Desks", "0", "0", "No, booked so far"],
      ["2026-10-20", "Rooms", "2", "1", "No, booked so far"],
    ]);
    expect(document.getElementById(toggle.getAttribute("aria-controls") ?? "")?.contains(table)).toBe(true);
  });

  it("labels the days ahead 'Booked so far', not 'Today', when the first of them is not today", () => {
    // Saturday: the days ahead start on Monday, after the past days.
    const { unmount } = render(<DailyColumns report={REPORT} range={RANGE} today="2026-10-17" />);
    const plot = screen.getByTestId("columns-desk");
    expect(within(plot).getByText("Booked so far")).toBeTruthy();
    expect(within(plot).queryByText("Today, booked so far")).toBeNull();
    expect(slots("desk").filter((s) => s.querySelector("[style]")?.className.match(/ahead/)).map((s) => s.dataset.date)).toEqual(["2026-10-19"]);
    unmount();
    // A range that starts after today: every day is ahead.
    render(<DailyColumns report={REPORT} range={RANGE} today="2026-10-01" />);
    expect(within(screen.getByTestId("columns-room")).getByText("Booked so far")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show table: bookings per day" }));
    const over = within(screen.getByRole("table", { name: "Bookings per day" }))
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[4]?.textContent);
    expect(new Set(over)).toEqual(new Set(["No, booked so far"]));
  });

  it("the table says so for an empty range", () => {
    render(<DailyColumns report={{ ...REPORT, daily: [] }} range={RANGE} today={TODAY} />);
    fireEvent.click(screen.getByRole("button", { name: "Show table: bookings per day" }));
    expect(within(screen.getByRole("table", { name: "Bookings per day" })).getByText("No bookings in this range yet.")).toBeTruthy();
  });

  it("says so for an empty range, and dims the last render while refetching", () => {
    const { rerender } = render(<DailyColumns report={{ ...REPORT, daily: [] }} range={RANGE} today={TODAY} />);
    expect(screen.getByText("No bookings in this range yet.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    rerender(<DailyColumns report={REPORT} range={RANGE} today={TODAY} refreshing />);
    const section = screen.getByRole("region", { name: "Bookings per day" });
    expect(section.getAttribute("aria-busy")).toBe("true");
    expect(section.className).toMatch(/refreshing/);
  });

  it("writes the column and summary sentences", () => {
    expect(columnText({ date: "2026-10-20", confirmed: 31, cancelled: 2, ahead: false }, "desk")).toBe("Tuesday, October 20: 31 desk bookings, 2 cancelled");
    expect(columnText({ date: "2026-10-20", confirmed: 1, cancelled: 0, ahead: true }, "room")).toBe("Tuesday, October 20: 1 room booking so far, 0 cancelled");
    expect(columnsSummary([{ date: "2026-10-05", confirmed: 0, cancelled: 0, ahead: false }], "desk", { from: "2026-10-05", to: "2026-10-05" }, "2026-10-16")).toBe(
      "Desk bookings per weekday, October 5 to October 5; none in this range",
    );
  });

  it("has no axe violations, with the table open too", async () => {
    render(<DailyColumns report={REPORT} range={RANGE} today={TODAY} />);
    await expectNoAxeViolations();
    fireEvent.click(screen.getByRole("button", { name: "Show table: bookings per day" }));
    await expectNoAxeViolations();
  });
});
