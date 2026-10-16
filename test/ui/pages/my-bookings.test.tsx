import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateResources } from "../../../src/shared/synthetic/resources.ts";
import { HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { renderAt } from "../render-app.tsx";

const base = { employeeId: "emp_001", kind: "desk", attendees: 1, title: null, createdAt: "x", cancelledAt: null, cancelledBy: null, cancelReason: null, version: 1 };
let reservations: Record<string, unknown>[];

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T15:00:00Z"));
  reservations = [
    { ...base, id: "rsv_up", resourceId: "res_2a01", date: "2026-10-12", startMin: 540, endMin: 660, status: "confirmed" },
    { ...base, id: "rsv_past", resourceId: "res_2b02", date: "2026-10-06", startMin: 540, endMin: 660, status: "confirmed" },
    { ...base, id: "rsv_gone", resourceId: "res_3a01", date: "2026-10-13", startMin: 600, endMin: 720, status: "cancelled", cancelReason: "Trip" },
  ];
  installFakeApi({
    "GET /api/health": HEALTH,
    "GET /api/me": me("emp_001", "employee"),
    "GET /api/sites/hq/resources": { resources: generateResources() },
    "GET /api/reservations": () => ({ reservations }),
    "POST /api/reservations/rsv_up/cancel": (c: { body: { reason?: string } }) => {
      const r = reservations[0] as Record<string, unknown>;
      Object.assign(r, { status: "cancelled", cancelReason: c.body.reason ?? null, cancelledBy: "emp_001", cancelledAt: "y", version: 2 });
      return { reservation: r, version: 2, dateVersion: 2 };
    },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const rowsOf = (caption: string) =>
  within(screen.getByRole("table", { name: caption }))
    .getAllByRole("row")
    .slice(1)
    .map((r) => within(r).getAllByRole("cell")[0]?.textContent);

// The empty Upcoming sentence keeps its words; "Find a space" inside it is a link.
const EMPTY = "No upcoming bookings. Find a space to book one.";
const emptyUpcoming = () => screen.getByText((_, el) => el?.tagName === "TD" && el.textContent === EMPTY);
const queryEmptyUpcoming = () => screen.queryByText((_, el) => el?.tagName === "TD" && el.textContent === EMPTY);

describe("My bookings (SPEC 14.1)", () => {
  it("splits bookings into Upcoming, Past and Cancelled tabs", async () => {
    renderAt("/bookings");
    await screen.findByRole("table", { name: "Upcoming bookings" });
    await waitFor(() => expect(rowsOf("Upcoming bookings")).toEqual(["Desk 2A-01"]));
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Past" }));
    expect(rowsOf("Past bookings")).toEqual(["Desk 2B-02"]);
    await user.click(screen.getByRole("tab", { name: "Cancelled" }));
    expect(rowsOf("Cancelled bookings")).toEqual(["Desk 3A-01"]);
    expect(screen.getByText("Trip")).toBeTruthy();
  });

  it("cancels with a reason and the row moves to the Cancelled tab", async () => {
    renderAt("/bookings");
    await waitFor(() => expect(rowsOf("Upcoming bookings")).toEqual(["Desk 2A-01"]));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /^Cancel booking for Desk 2A-01/ }));
    const dialog = screen.getByRole("dialog", { name: "Cancel this booking?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Keep booking" }));
    await user.type(within(dialog).getByRole("textbox", { name: "Reason (optional)" }), "Working from home");
    await user.click(within(dialog).getByRole("button", { name: "Cancel booking" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(emptyUpcoming()).toBeTruthy());
    expect(within(emptyUpcoming()).getByRole("link", { name: "Find a space" }).getAttribute("href")).toBe("/find");
    await waitFor(() => expect(screen.getByTestId("announcer").textContent).toBe("Cancelled Desk 2A-01 on Monday, October 12, 2026."));
    const banner = screen.getByTestId("status-banner");
    expect(banner.textContent).toContain("Cancelled Desk 2A-01 on Monday, October 12, 2026.");
    expect(within(banner).getByRole("link", { name: "Find a space" }).getAttribute("href")).toBe("/find");
    expect(document.activeElement).toBe(banner);
    await user.click(screen.getByRole("tab", { name: "Cancelled" }));
    expect(rowsOf("Cancelled bookings")).toEqual(["Desk 2A-01", "Desk 3A-01"]);
    expect(screen.getByText("Working from home")).toBeTruthy();
  });

  it("while loading shows a status and never the empty sentence", async () => {
    let release: (v: unknown) => void = () => {};
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/sites/hq/resources": { resources: generateResources() },
      "GET /api/reservations": () => new Promise((r) => (release = r)).then(() => ({ reservations: [] })),
    });
    renderAt("/bookings");
    expect(await screen.findByText("Loading your bookings…")).toBeTruthy();
    expect(queryEmptyUpcoming()).toBeNull();
    release(null);
    expect(await screen.findByRole("table", { name: "Upcoming bookings" })).toBeTruthy();
    expect(emptyUpcoming()).toBeTruthy();
    expect(screen.queryByText("Loading your bookings…")).toBeNull();
  });

  it("after a failed load shows only the error and Try again, which reloads the list", async () => {
    let failures = 1;
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/sites/hq/resources": { resources: generateResources() },
      "GET /api/reservations": () => (failures-- > 0 ? respond(500, { error: "internal", message: "x" }) : { reservations }),
    });
    renderAt("/bookings");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Your bookings could not be loaded.");
    expect(queryEmptyUpcoming()).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(rowsOf("Upcoming bookings")).toEqual(["Desk 2A-01"]));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
