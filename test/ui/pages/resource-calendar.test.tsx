import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateResources } from "../../../src/shared/synthetic/resources.ts";
import { addDays } from "../../../src/shared/time.ts";
import { HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { FakeWebSocket } from "../fake-ws.ts";
import { renderAt } from "../render-app.tsx";

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

  it("marks past days and weekends as unavailable", async () => {
    installFakeApi({ "GET /api/health": HEALTH, "GET /api/me": me("emp_001", "employee"), "GET /api/resources/res_sequoia/calendar": (c: { url: string }) => calendar(c.url) });
    renderAt("/resources/res_sequoia");
    await screen.findByRole("heading", { level: 1, name: "Sequoia" });
    expect(screen.getByRole("gridcell", { name: "Monday 10/05, 13:00 to 13:30, past" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "Saturday 10/10, 13:00 to 13:30, past" }).getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "Friday 10/09, 13:00 to 13:30, available" }).getAttribute("aria-disabled")).toBeNull();
  });
});
