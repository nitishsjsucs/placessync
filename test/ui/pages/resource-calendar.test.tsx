import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateResources } from "../../../src/shared/synthetic/resources.ts";
import { addDays } from "../../../src/shared/time.ts";
import { HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { FakeWebSocket } from "../fake-ws.ts";
import { renderAt } from "../render-app.tsx";
import { setMediaMatches } from "../setup.ts";

const SEQUOIA = generateResources().find((r) => r.id === "res_sequoia");

function calendar(url: string) {
  const weekStart = new URL(url, "http://x").searchParams.get("weekStart") ?? "";
  return {
    resource: SEQUOIA,
    days: Array.from({ length: 7 }, (_, i) => ({
      date: addDays(weekStart, i),
      busy: i === 1 ? [{ startMin: 540, endMin: 600, mine: true, reservationId: "rsv_mine" }, { startMin: 660, endMin: 720, mine: false }] : [],
    })),
  };
}

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T15:00:00Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("resource week calendar (SPEC 14.1)", () => {
  it("renders 7 day rows, marks mine, moves between weeks and books from a range", async () => {
    const api = installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/resources/res_sequoia/calendar": (c: { url: string }) => calendar(c.url),
      "POST /api/reservations": (c: { body: Record<string, unknown> }) =>
        respond(201, {
          reservation: { id: "rsv_new", employeeId: "emp_001", kind: "room", attendees: 1, title: null, status: "confirmed", createdAt: "x", cancelledAt: null, cancelledBy: null, cancelReason: null, version: 3, ...c.body },
          version: 3,
          dateVersion: 2,
        }),
    });
    renderAt("/resources/res_sequoia");
    expect(await screen.findByRole("heading", { level: 1, name: "Sequoia" })).toBeTruthy();
    const grid = screen.getByRole("grid", { name: /Sequoia, week of Monday, October 5, 2026/ });
    expect(within(grid).getAllByRole("rowheader").map((h) => h.textContent)).toEqual([
      "Monday 10/05",
      "Tuesday 10/06",
      "Wednesday 10/07",
      "Thursday 10/08",
      "Friday 10/09",
      "Saturday 10/10",
      "Sunday 10/11",
    ]);
    expect(within(grid).getByRole("gridcell", { name: "Tuesday 10/06, 09:00 to 09:30, your booking" })).toBeTruthy();
    expect(within(grid).getByRole("gridcell", { name: "Tuesday 10/06, 11:00 to 11:30, booked" })).toBeTruthy();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Next week" }));
    await waitFor(() => expect(api.calls.at(-1)?.url).toContain("weekStart=2026-10-12"));
    expect(await screen.findByRole("grid", { name: /week of Monday, October 12, 2026/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(api.calls.at(-1)?.url).toContain("weekStart=2026-10-05"));
    await user.click(screen.getByRole("button", { name: "Next week" }));

    await user.click(await screen.findByRole("gridcell", { name: "Wednesday 10/14, 13:00 to 13:30, available" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("gridcell", { name: "Wednesday 10/14, 13:30 to 14:00, available" }));
    await user.keyboard("{/Shift}");
    await user.click(screen.getByRole("button", { name: /^Book Wednesday, October 14, 2026, 13:00 to 14:00/ }));
    await user.click(within(await screen.findByRole("dialog", { name: "Book Sequoia" })).getByRole("button", { name: "Confirm booking" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.find((c) => c.method === "POST")?.body).toMatchObject({ resourceId: "res_sequoia", date: "2026-10-14", startMin: 780, endMin: 840 });
    await waitFor(() => expect(screen.getByTestId("announcer").textContent).toBe("Booked Sequoia on Wednesday, October 14, 2026, 13:00 to 14:00."));
  });

  it("names past days, weekends and days beyond the horizon, and draws them unlike booked cells", async () => {
    installFakeApi({ "GET /api/health": HEALTH, "GET /api/me": me("emp_001", "employee"), "GET /api/resources/res_sequoia/calendar": (c: { url: string }) => calendar(c.url) });
    const { router } = renderAt("/resources/res_sequoia");
    await screen.findByRole("heading", { level: 1, name: "Sequoia" });
    const past = screen.getByRole("gridcell", { name: "Monday 10/05, 13:00 to 13:30, past" });
    expect(past.getAttribute("aria-disabled")).toBe("true");
    expect(past.className).toMatch(/unavailable/);
    expect(past.className).not.toMatch(/busy/);
    const saturday = screen.getByRole("gridcell", { name: "Saturday 10/10, 13:00 to 13:30, closed" });
    expect(saturday.getAttribute("aria-disabled")).toBe("true");
    expect(saturday.className).toMatch(/unavailable/);
    // Today (Thursday 08:00): the 07:30 slot has started, the 08:30 one has not.
    expect(screen.getByRole("gridcell", { name: "Thursday 10/08, 07:30 to 08:00, past" }).className).toMatch(/unavailable/);
    expect(screen.getByRole("gridcell", { name: "Thursday 10/08, 08:30 to 09:00, available" }).getAttribute("aria-disabled")).toBeNull();
    expect(screen.getByRole("gridcell", { name: "Friday 10/09, 13:00 to 13:30, available" }).getAttribute("aria-disabled")).toBeNull();
    // A booked cell in a past day still says booked, hatched.
    const booked = screen.getByRole("gridcell", { name: "Tuesday 10/06, 11:00 to 11:30, booked" });
    expect(booked.className).toMatch(/busy/);
    expect(booked.className).not.toMatch(/unavailable/);

    await router.navigate("/resources/res_sequoia?week=2026-10-19");
    expect(await screen.findByRole("gridcell", { name: "Thursday 10/22, 13:00 to 13:30, available" })).toBeTruthy();
    expect(screen.getByRole("gridcell", { name: "Friday 10/23, 13:00 to 13:30, not open for booking yet" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "Saturday 10/24, 13:00 to 13:30, closed" })).toBeTruthy();
  });

  it("compact chips carry the same words", async () => {
    setMediaMatches("(max-width: 639px)", true);
    installFakeApi({ "GET /api/health": HEALTH, "GET /api/me": me("emp_001", "employee"), "GET /api/resources/res_sequoia/calendar": (c: { url: string }) => calendar(c.url) });
    renderAt("/resources/res_sequoia?week=2026-10-19");
    const compact = await screen.findByTestId("slotgrid-compact");
    const select = within(compact).getByRole("combobox", { name: "Day" });
    const user = userEvent.setup();
    await user.selectOptions(select, "2026-10-23");
    const chip = within(compact).getByRole("button", { name: "13:00 to 13:30, not open for booking yet" }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(chip.className).toMatch(/chipUnavailable/);
    await user.selectOptions(select, "2026-10-24");
    expect(within(compact).getByRole("button", { name: "13:00 to 13:30, closed" })).toBeTruthy();
    await user.selectOptions(select, "2026-10-22");
    expect((within(compact).getByRole("button", { name: "13:00 to 13:30" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("a missing space links to Find a space; a failed load offers Try again", async () => {
    let failures = 1;
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/resources/res_nope/calendar": respond(404, { error: "resource_not_found", message: "No such resource." }),
      "GET /api/resources/res_sequoia/calendar": (c: { url: string }) => (failures-- > 0 ? respond(500, { error: "internal", message: "x" }) : calendar(c.url)),
    });
    const { router } = renderAt("/resources/res_nope");
    expect(await screen.findByText("There is no such space.")).toBeTruthy();
    expect(within(screen.getByRole("main")).getByRole("link", { name: "Find a space" }).getAttribute("href")).toBe("/find");
    await router.navigate("/resources/res_sequoia");
    await waitFor(() => expect(screen.queryByText("There is no such space.")).toBeNull());
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The calendar could not be loaded.");
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sequoia" })).toBeTruthy();
  });

  it("opens on the week of ?date, keeps the shown week in ?week, and links back to Find a space on a date in view", async () => {
    const api = installFakeApi({ "GET /api/health": HEALTH, "GET /api/me": me("emp_001", "employee"), "GET /api/resources/res_sequoia/calendar": (c: { url: string }) => calendar(c.url) });
    const { router, unmount } = renderAt("/resources/res_sequoia?date=2026-10-21");
    expect(await screen.findByRole("grid", { name: /Sequoia, week of Monday, October 19, 2026/ })).toBeTruthy();
    expect(api.calls.at(-1)?.url).toContain("weekStart=2026-10-19");
    const back = () => within(screen.getByRole("main")).getByRole("link", { name: "Back to Find a space" });
    expect(back().getAttribute("href")).toBe("/find?date=2026-10-21");
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Previous week" }));
    await waitFor(() => expect(router.state.location.search).toBe("?week=2026-10-12"));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(await screen.findByRole("grid", { name: /week of Monday, October 12, 2026/ })).toBeTruthy();
    // The date it was opened for is not in this week: the week's first bookable day.
    expect(back().getAttribute("href")).toBe("/find?date=2026-10-12");
    unmount();

    renderAt("/resources/res_sequoia?week=2026-10-28");
    expect(await screen.findByRole("grid", { name: /Sequoia, week of Monday, October 26, 2026/ })).toBeTruthy();
    // Nothing in that week is bookable yet (the horizon ends on 2026-10-22).
    expect(back().getAttribute("href")).toBe("/find");
  });

  it("one click on a desk's week grid selects an hour", async () => {
    const desk = generateResources().find((r) => r.id === "res_2a01");
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/resources/res_2a01/calendar": (c: { url: string }) => ({ ...calendar(c.url), resource: desk }),
    });
    renderAt("/resources/res_2a01");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("gridcell", { name: "Friday 10/09, 13:00 to 13:30, available" }));
    expect(screen.getByRole("button", { name: "Book Friday, October 9, 2026, 13:00 to 14:00" })).toBeTruthy();
  });
});
