import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateResources } from "../../../src/shared/synthetic/resources.ts";
import { type FakeApi, HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { renderAt } from "../render-app.tsx";

// Today is Thursday 2026-10-08 (HEALTH). The default range is 2026-09-10 to 2026-10-22:
// 20 weekdays before today (held) and 11 from today on (ahead), 720 open minutes each.
const RESOURCES = [
  { ...generateResources()[0]!, active: true },
  { ...generateResources()[1]!, active: false },
  { ...generateResources().find((r) => r.id === "res_redwood")!, active: true },
];
const HELD_DAYS = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-21", "2026-09-22", "2026-09-23"];
const UTIL = {
  from: "2026-09-10",
  to: "2026-10-22",
  kind: null,
  rows: [
    // 8 days of 684 minutes: 5,472 of 14,400 held minutes, 38%.
    ...HELD_DAYS.map((date) => ({ resourceId: "res_2a01", kind: "desk", name: "Desk 2A-01", date, bookings: 2, bookedMin: 684, utilization: 0.95 })),
    { resourceId: "res_2a01", kind: "desk", name: "Desk 2A-01", date: "2026-10-12", bookings: 1, bookedMin: 360, utilization: 0.5 },
    { resourceId: "res_2a02", kind: "desk", name: "Desk 2A-02", date: "2026-09-14", bookings: 1, bookedMin: 120, utilization: 0.1667 },
    { resourceId: "res_redwood", kind: "room", name: "Redwood", date: "2026-10-12", bookings: 1, bookedMin: 30, utilization: 0.0417 },
  ],
  hourly: [
    { date: "2026-09-14", resourceKind: "desk", hour: 9, occupied: 2 },
    { date: "2026-10-12", resourceKind: "desk", hour: 9, occupied: 1 },
    { date: "2026-10-12", resourceKind: "room", hour: 10, occupied: 1 },
  ],
  daily: [
    { date: "2026-09-14", resourceKind: "desk", confirmed: 3, cancelled: 0 },
    { date: "2026-10-12", resourceKind: "desk", confirmed: 1, cancelled: 1 },
    { date: "2026-10-12", resourceKind: "room", confirmed: 1, cancelled: 0 },
  ],
  totals: { bookings: 20, bookedMin: 5982, resourceDays: 11, openMinutesPerDay: 720 },
};
const STATUS = { ledgerVersion: 40, outboxDepth: 0, backstopHits: 0, lastFlushError: null, flushFailures: 0, d1: { maxLedgerVersion: 40, updatedAt: "2026-10-08T17:05:00.000Z" } };

let api: FakeApi;
beforeEach(() => {
  api = installFakeApi({
    "GET /api/sites/hq/resources": { resources: RESOURCES },
    "PATCH /api/admin/resources/res_2a01": { resource: { ...generateResources()[0], active: false } },
    "PATCH /api/admin/resources/res_2a02": { resource: { ...generateResources()[1], active: true } },
    "GET /api/health": HEALTH,
    "GET /api/me": me("emp_100", "facilities_admin"),
    "GET /api/admin/projection/status": STATUS,
    "GET /api/admin/reports/utilization": UTIL,
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
  const cells = (table: HTMLElement) =>
    within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));

  const DESKS = /^Desks: utilization by space, Thursday, September 10, 2026 to Thursday, October 22, 2026/;
  const ROOMS = /^Rooms: utilization by space, Thursday, September 10, 2026 to Thursday, October 22, 2026/;

  it("lists every space by kind on a fixed 0 to 100% scale, held apart from booked ahead, and the daily rows on request (VIZ-06)", async () => {
    renderAt("/admin");
    const desks = await screen.findByRole("table", { name: DESKS });
    expect(desks.querySelector("caption")?.textContent).toMatch(/\(average held 38%\)$/);
    expect(cells(desks)).toEqual([
      // Sorted by Held, highest first. The inactive desk is listed but not in the average.
      ["Desk 2A-01", "38%", "5%", "17", "9"],
      ["Desk 2A-02 (inactive)", "1%", "Not booked", "1", "1"],
    ]);
    const bar = within(desks).getAllByTestId("fixed-bar")[0] as HTMLElement;
    // 38% draws 38% of the track, not full width.
    expect(bar.style.width).toBe("38%");
    expect(within(desks).getByRole("link", { name: "Desk 2A-01" }).getAttribute("href")).toBe("/resources/res_2a01");
    const rooms = screen.getByRole("table", { name: ROOMS });
    expect(rooms.querySelector("caption")?.textContent).toMatch(/\(average held 0%\)$/);
    expect(cells(rooms)).toEqual([["Redwood", "Not booked", "0%", "1", "1"]]);
    expect(within(desks).getAllByRole("columnheader").map((h) => h.textContent?.replace(/[▲▼↕]/g, ""))).toEqual(["Space", "Held", "Booked ahead", "Bookings", "Days booked"]);
    expect(within(desks).getByRole("columnheader", { name: /Held/ }).getAttribute("aria-sort")).toBe("descending");

    const toggle = screen.getByRole("button", { name: "Show daily rows" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await userEvent.setup().click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const dailyRows = screen.getByRole("table", { name: /^Utilization, / });
    expect(cells(dailyRows)[0]).toEqual(["Desk 2A-01", "2026-09-14", "2", "11.4", "95%"]);
    // The daily rows use the same fixed scale: 0.95 is 95% of the track.
    expect((within(dailyRows).getAllByTestId("fixed-bar")[0] as HTMLElement).style.width).toBe("95%");
  });

  it("sorts by Held, Booked ahead and Space", async () => {
    renderAt("/admin");
    const desks = await screen.findByRole("table", { name: DESKS });
    const user = userEvent.setup();
    await user.click(within(desks).getByRole("button", { name: /^Booked ahead/ }));
    expect(cells(desks).map((r) => r[0])).toEqual(["Desk 2A-02 (inactive)", "Desk 2A-01"]);
    await user.click(within(desks).getByRole("button", { name: /^Space/ }));
    expect(cells(desks).map((r) => r[0])).toEqual(["Desk 2A-01", "Desk 2A-02 (inactive)"]);
  });

  it("puts every active space in the table, even one with no bookings in the range", async () => {
    api.set("GET /api/sites/hq/resources", { resources: [...RESOURCES, { ...generateResources().find((r) => r.id === "res_alder")!, active: true }] });
    renderAt("/admin");
    const rooms = await screen.findByRole("table", { name: ROOMS });
    await waitFor(() => expect(cells(rooms).map((r) => r[0]).sort()).toEqual(["Alder", "Redwood"]));
    expect(cells(rooms).find((r) => r[0] === "Alder")).toEqual(["Alder", "Not booked", "Not booked", "0", "0"]);
  });

  it("opens on report freshness, four tiles, the bookings-per-day chart, then the tables (VIZ-07)", async () => {
    renderAt("/admin");
    const desks = await screen.findByRole("table", { name: DESKS });
    const freshness = screen.getByTestId("freshness");
    expect(freshness.textContent).toBe("Reports include every booking change (last copied 10:05).");
    const tiles = screen.getByRole("list", { name: "Utilization at a glance" });
    expect(within(tiles).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Desk time booked, past days38%of the 1 desk bookable now",
      "Room time booked, past days0%of the 1 room bookable now",
      "Booked ahead2 bookingsfrom today to Thursday, October 22, 2026",
      "Cancelled1 of 617% of bookings in the range",
    ]);
    const chart = screen.getByRole("heading", { level: 2, name: "Bookings per day" });
    const hourly = screen.getByRole("heading", { level: 2, name: "Bookings by hour" });
    const order = [freshness, tiles, chart, desks, hourly];
    for (let i = 1; i < order.length; i++) expect(order[i - 1]!.compareDocumentPosition(order[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The old one-line summary mixing held and future days is gone.
    expect(screen.queryByText(/resource-days/)).toBeNull();
  });

  it("keeps the hourly table and the daily table behind their own Show table, with the hourly caption saying what it counts", async () => {
    renderAt("/admin");
    await screen.findByRole("table", { name: DESKS });
    expect(screen.queryByRole("table", { name: /^Bookings overlapping each hour/ })).toBeNull();
    const user = userEvent.setup();
    const showHourly = screen.getByRole("button", { name: "Show table: bookings by hour" });
    expect(showHourly.getAttribute("aria-expanded")).toBe("false");
    await user.click(showHourly);
    expect(showHourly.getAttribute("aria-expanded")).toBe("true");
    const hourly = screen.getByRole("table", { name: "Bookings overlapping each hour, averaged over days with any booking in the range" });
    expect(within(hourly).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Hour", "Desk bookings", "Room bookings"]);
    const nine = within(hourly).getByText("09:00").closest("tr") as HTMLElement;
    expect(within(nine).getAllByRole("cell").map((c) => c.textContent)).toEqual(["09:00", "1.5", "0"]);
    await user.click(screen.getByRole("button", { name: "Show table: bookings per day" }));
    const daily = screen.getByRole("table", { name: "Bookings per day" });
    // A row per weekday and kind, as the charts draw them: 31 weekdays from September 10 to October 22.
    const rows = within(daily)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));
    expect(rows).toHaveLength(62);
    expect(rows.find((r) => r[0] === "2026-09-14" && r[1] === "Desks")).toEqual(["2026-09-14", "Desks", "3", "0", "Yes"]);
    expect(rows.find((r) => r[0] === "2026-10-12" && r[1] === "Desks")).toEqual(["2026-10-12", "Desks", "1", "1", "No, booked so far"]);
  });

  it("makes one projection status GET with the reports, and another on Refresh when reports lag", async () => {
    api.set("GET /api/admin/projection/status", { ...STATUS, outboxDepth: 3 });
    renderAt("/admin");
    await screen.findByRole("table", { name: DESKS });
    const statusGets = () => api.calls.filter((c) => c.method === "GET" && c.url === "/api/admin/projection/status");
    const utilGets = () => api.calls.filter((c) => c.method === "GET" && c.url.startsWith("/api/admin/reports/utilization"));
    expect(statusGets()).toHaveLength(1);
    expect(utilGets()).toHaveLength(1);
    expect(screen.getByTestId("freshness").textContent).toContain(
      "3 booking changes had not reached these reports when they loaded. The ledger copies them shortly; in production this can take up to a minute.",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(statusGets()).toHaveLength(2));
    expect(utilGets()).toHaveLength(2);
  });

  it("a flush error shows the warning; a failed status fetch hides only the freshness line", async () => {
    api.set("GET /api/admin/projection/status", { ...STATUS, lastFlushError: "D1_ERROR: busy" });
    const { unmount } = renderAt("/admin");
    const line = await screen.findByText("Copying bookings to reports is failing; bookings themselves are safe in the ledger.");
    expect(line.querySelector("svg[aria-hidden=true]")).toBeTruthy();
    unmount();
    api.set("GET /api/admin/projection/status", respond(500, { error: "internal", message: "x" }));
    renderAt("/admin");
    expect(await screen.findByRole("table", { name: DESKS })).toBeTruthy();
    expect(screen.queryByTestId("freshness")).toBeNull();
    expect(screen.getByRole("list", { name: "Utilization at a glance" })).toBeTruthy();
  });

  it("a preset re-renders the tiles, the chart and the tables for the new range", async () => {
    renderAt("/admin");
    await screen.findByRole("table", { name: DESKS });
    api.set("GET /api/admin/reports/utilization", { ...UTIL, from: "2026-10-08", to: "2026-10-22", rows: UTIL.rows.filter((r) => r.date >= "2026-10-08"), daily: UTIL.daily.filter((d) => d.date >= "2026-10-08") });
    await userEvent.setup().click(screen.getByRole("button", { name: "Next 2 weeks" }));
    const desks = await screen.findByRole("table", { name: /^Desks: utilization by space, Thursday, October 8, 2026 to Thursday, October 22, 2026 \(no past days\)$/ });
    expect(cells(desks)[0]).toEqual(["Desk 2A-01", "No past days", "5%", "1", "1"]);
    const tiles = screen.getByRole("list", { name: "Utilization at a glance" });
    expect(within(tiles).getAllByRole("listitem")[0]?.textContent).toBe("Desk time booked, past daysNo past days in this range.");
    expect(screen.getByRole("img", { name: /^Desk bookings per weekday, October 8 to October 22;/ })).toBeTruthy();
  });

  it("shows agreement per provider with each provider's own label, and AI only for Workers AI", async () => {
    renderAt("/admin");
    await screen.findByRole("table", { name: DESKS });
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
    expect(screen.getByText(/Median time to review: 43 min \(20 reviewed\)/)).toBeTruthy();
    expect(screen.getByRole("table", { name: "Requests by category and status" })).toBeTruthy();
  });

  const patches = () => api.calls.filter((c) => c.method === "PATCH");

  it("deactivating asks first; activating is one click (Tier 2)", async () => {
    renderAt("/admin");
    await screen.findByRole("table", { name: DESKS });
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    const table = await screen.findByRole("table", { name: "Resources" });
    expect(within(table).getByText("Inactive")).toBeTruthy();
    await user.click(within(table).getByRole("button", { name: "Deactivate Desk 2A-01" }));
    let dialog = screen.getByRole("dialog", { name: "Deactivate Desk 2A-01?" });
    expect(within(dialog).getByText("Existing bookings are kept. Nobody can book it until it is activated again.")).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Keep active" }));
    await user.click(within(dialog).getByRole("button", { name: "Keep active" }));
    expect(patches()).toHaveLength(0);

    await user.click(within(table).getByRole("button", { name: "Deactivate Desk 2A-01" }));
    dialog = screen.getByRole("dialog", { name: "Deactivate Desk 2A-01?" });
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(patches()).toEqual([expect.objectContaining({ url: "/api/admin/resources/res_2a01", body: { active: false } })]);
    expect((await screen.findByTestId("status-banner")).textContent).toContain("Desk 2A-01 is now inactive.");

    await user.click(within(table).getByRole("button", { name: "Activate Desk 2A-02" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches()[1]).toMatchObject({ url: "/api/admin/resources/res_2a02", body: { active: true } });
  });

  it("a failed toggle shows an alert on the page", async () => {
    api.set("PATCH /api/admin/resources/res_2a02", respond(500, { error: "internal", message: "Something went wrong." }));
    renderAt("/admin");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Resources" }));
    await user.click(await screen.findByRole("button", { name: "Activate Desk 2A-02" }));
    const alert = await within(screen.getByRole("main")).findByText("Could not save. Check your connection and try again.");
    expect(alert.getAttribute("role")).toBe("alert");
  });

  it("checks a room's capacity before sending, and maps a server capacity issue to the same words", async () => {
    const room = generateResources().find((r) => r.id === "res_sequoia");
    api.set("GET /api/sites/hq/resources", { resources: [room] });
    api.set("PATCH /api/admin/resources/res_sequoia", respond(422, { error: "validation", message: "bad", issues: [{ path: "capacity", code: "too_big", message: "Too big: expected number to be <=50" }] }));
    renderAt("/admin");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Resources" }));
    await user.click(await screen.findByRole("button", { name: "Edit Sequoia" }));
    const dialog = screen.getByRole("dialog", { name: "Edit Sequoia" });
    const field = within(dialog).getByRole("spinbutton", { name: "Capacity" });
    for (const bad of ["0", "51", "2.5", ""]) {
      await user.clear(field);
      if (bad) await user.type(field, bad);
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      expect(within(dialog).getByText("Enter a whole number from 1 to 50.")).toBeTruthy();
    }
    expect(patches()).toHaveLength(0);
    await user.clear(field);
    await user.type(field, "12");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(patches()).toHaveLength(1));
    expect(patches()[0]?.body).toMatchObject({ capacity: 12 });
    expect(await within(dialog).findByText("Enter a whole number from 1 to 50.")).toBeTruthy();
    expect(screen.queryByText(/expected number/)).toBeNull();
  });

  it("presets set both dates and refetch both reports; To before From is refused with a form alert", async () => {
    renderAt("/admin");
    await screen.findByRole("table", { name: DESKS });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Last 7 days" }));
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe("2026-10-02");
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe("2026-10-08");
    await waitFor(() =>
      expect(api.calls.filter((c) => c.url.includes("from=2026-10-02&to=2026-10-08")).map((c) => c.url.split("?")[0])).toEqual(
        expect.arrayContaining(["/api/admin/reports/utilization", "/api/admin/reports/requests"]),
      ),
    );
    expect(screen.getByLabelText("From").getAttribute("type")).toBe("date");

    const before = api.calls.length;
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-01" } });
    await user.click(screen.getByRole("button", { name: "Apply range" }));
    const alert = await screen.findByText("To must be on or after From.");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(api.calls.length).toBe(before);
  });

  it("prints a median over an hour in hours and minutes", async () => {
    api.set("GET /api/admin/reports/requests", { from: "x", to: "y", categories: [], agreement: [], medianMinutesToReview: 783.5, reviewedCount: 3 });
    renderAt("/admin");
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Requests" }));
    expect(await screen.findByText(/Median time to review: 13 h 4 min \(3 reviewed\)/)).toBeTruthy();
  });

  it("failed report and resource loads each offer Try again", async () => {
    let reportFailures = 1;
    let resourceFailures = 1;
    const realUtil = { from: "2026-09-10", to: "2026-10-22", kind: null, rows: [], hourly: [], daily: [], totals: { bookings: 0, bookedMin: 0, resourceDays: 0, openMinutesPerDay: 720 } };
    api.set("GET /api/admin/reports/utilization", () => (reportFailures-- > 0 ? respond(500, { error: "internal", message: "x" }) : realUtil));
    api.set("GET /api/sites/hq/resources", () =>
      resourceFailures-- > 0 ? respond(500, { error: "internal", message: "x" }) : { resources: generateResources().slice(0, 2) },
    );
    renderAt("/admin");
    const user = userEvent.setup();
    const reportsAlert = (await screen.findByText("Reports could not be loaded.")).closest("[role=alert]") as HTMLElement;
    await user.click(within(reportsAlert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("No bookings in this range yet.")).toBeTruthy();
    // The tiles and tables need the space list, so its failure shows on this tab too.
    expect(screen.getByText("Resources could not be loaded.")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    const resourcesAlert = (await screen.findByText("Resources could not be loaded.")).closest("[role=alert]") as HTMLElement;
    await user.click(within(resourcesAlert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Resources" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Resources could not be loaded.")).toBeNull());
  });
});

describe("Deactivate names what reports show from today on (VIZ-06)", () => {
  const UPCOMING = "GET /api/admin/reports/utilization?from=2026-10-08&to=2026-10-22&kind=desk";
  const report = (rows: { resourceId: string; date: string; bookings: number }[]) => ({
    ...UTIL,
    from: "2026-10-08",
    to: "2026-10-22",
    kind: "desk",
    rows: rows.map((r) => ({ ...r, kind: "desk", name: r.resourceId === "res_2a01" ? "Desk 2A-01" : "Desk 2A-02", bookedMin: 60 * r.bookings, utilization: 0.1 })),
  });

  async function openDialog() {
    renderAt("/admin");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("tab", { name: "Resources" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate Desk 2A-01" }));
    const dialog = screen.getByRole("dialog", { name: "Deactivate Desk 2A-01?" });
    return { dialog, user };
  }

  it("asks the utilization report for today through the horizon, narrowed to the space's kind, and names the count and the first date", async () => {
    api.set(UPCOMING, report([{ resourceId: "res_2a01", date: "2026-10-20", bookings: 2 }, { resourceId: "res_2a01", date: "2026-10-12", bookings: 1 }, { resourceId: "res_2a02", date: "2026-10-09", bookings: 4 }]));
    const { dialog } = await openDialog();
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Keep active" }));
    const status = await within(dialog).findByText(/^Reports show 3 bookings/);
    expect(status.textContent).toBe("Reports show 3 bookings for Desk 2A-01 from today on, the first on Monday, October 12. They stay booked, and My bookings marks the space (not bookable now).");
    expect(status.getAttribute("role")).toBe("status");
    expect(within(dialog).getByText("Existing bookings are kept. Nobody can book it until it is activated again.")).toBeTruthy();
    expect(api.calls.filter((c) => c.url.startsWith("/api/admin/reports/utilization?from=2026-10-08")).map((c) => c.url)).toEqual([
      "/api/admin/reports/utilization?from=2026-10-08&to=2026-10-22&kind=desk",
    ]);
  });

  it("marks a first date that is today, for one booking and for several", async () => {
    api.set(UPCOMING, report([{ resourceId: "res_2a01", date: "2026-10-08", bookings: 1 }]));
    const first = await openDialog();
    expect(await within(first.dialog).findByText("Reports show 1 booking for Desk 2A-01 from today on, on Thursday, October 8 (today). It stays booked, and My bookings marks the space (not bookable now).")).toBeTruthy();
    cleanup();
    api.set(UPCOMING, report([{ resourceId: "res_2a01", date: "2026-10-13", bookings: 1 }, { resourceId: "res_2a01", date: "2026-10-08", bookings: 2 }]));
    const several = await openDialog();
    expect(await within(several.dialog).findByText("Reports show 3 bookings for Desk 2A-01 from today on, the first on Thursday, October 8 (today). They stay booked, and My bookings marks the space (not bookable now).")).toBeTruthy();
  });

  it("says so when reports show none", async () => {
    api.set(UPCOMING, report([{ resourceId: "res_2a02", date: "2026-10-09", bookings: 4 }]));
    const { dialog } = await openDialog();
    expect(await within(dialog).findByText("Reports show no bookings for Desk 2A-01 from today on.")).toBeTruthy();
  });

  it("says it is checking while the report loads, and keeps Deactivate enabled", async () => {
    api.set(UPCOMING, () => new Promise(() => {}));
    const { dialog } = await openDialog();
    const status = within(dialog).getByText("Checking upcoming bookings…");
    expect(status.getAttribute("role")).toBe("status");
    expect((within(dialog).getByRole("button", { name: "Deactivate" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("never assumes zero when the check fails", async () => {
    api.set(UPCOMING, respond(500, { error: "internal", message: "x" }));
    const { dialog, user } = await openDialog();
    expect(await within(dialog).findByText("Upcoming bookings could not be checked.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(api.calls.some((c) => c.method === "PATCH" && c.url === "/api/admin/resources/res_2a01")).toBe(true));
  });
});

describe("Requests tab: staff decisions and time to review (VIZ-09)", () => {
  const REQUESTS = {
    from: "2026-09-10",
    to: "2026-10-22",
    categories: [{ category: "electrical_av", status: "assigned", n: 4 }],
    agreement: [
      { provider: "stub", reviewed: 8, agreed: 6, agreementRate: 0.75 },
      { provider: "workers-ai", reviewed: 3, agreed: 3, agreementRate: 1 },
    ],
    medianMinutesToReview: 783.5,
    reviewedCount: 12,
    kept: [
      { provider: "stub", suggested: "electrical_av", final: "electrical_av", n: 5 },
      { provider: "stub", suggested: "furniture_fixtures", final: "building_systems", n: 2 },
      { provider: "stub", suggested: "furniture_fixtures", final: "furniture_fixtures", n: 1 },
      { provider: "workers-ai", suggested: "cleaning_safety", final: "cleaning_safety", n: 3 },
    ],
    reviewBuckets: [
      { bucket: "under_1h", n: 2 },
      { bucket: "1h_to_4h", n: 3 },
      { bucket: "4h_to_24h", n: 1 },
      { bucket: "over_24h", n: 6 },
    ],
  };

  async function openRequests() {
    renderAt("/admin");
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Requests" }));
    return screen.findByRole("table", { name: "Suggestion agreement by provider" });
  }

  it("keeps the agreement table, then one matrix per provider whose totals match it, then the review-time chart", async () => {
    api.set("GET /api/admin/reports/requests", REQUESTS);
    const agreement = await openRequests();
    const stub = await screen.findByRole("table", { name: "Keyword stub (keyword-v1): suggested category by final category" });
    const ai = screen.getByRole("table", { name: "Workers AI: suggested category by final category" });
    expect(agreement.compareDocumentPosition(stub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The stub's diagonal is its "Staff agreed" (6) and its cells sum to "Reviewed" (8).
    const keptCells = within(stub).getAllByRole("row").slice(1).map((r) => (within(r).getAllByRole("cell").at(-1) as HTMLElement).textContent);
    expect(keptCells).toEqual(["kept 5 of 5", "kept 1 of 3"]);
    expect(screen.getByText("Most changed: Furniture and fixtures suggestions became Building systems 2 times.")).toBeTruthy();
    expect(screen.getByText("Staff kept every suggestion.")).toBeTruthy();
    expect(within(ai).getAllByRole("row")).toHaveLength(2);
    expect(stub.textContent).not.toMatch(/\bAI\b/);
    const buckets = screen.getByRole("img", { name: /^Reviews by time from submission:/ });
    expect(stub.compareDocumentPosition(buckets) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The first span in each column is its printed count.
    const counts = [...buckets.querySelectorAll("[data-bucket]")].map((s) => Number(s.querySelector("span")?.textContent));
    expect(counts.reduce((a, b) => a + b, 0)).toBe(REQUESTS.reviewedCount);
    expect(screen.getByText("Median time to review: 13 h 4 min (12 reviewed).")).toBeTruthy();
    expect(screen.getByRole("table", { name: "Requests by category and status" })).toBeTruthy();
  });

  it("says so when no suggestion was reviewed in the range", async () => {
    api.set("GET /api/admin/reports/requests", { ...REQUESTS, agreement: [], kept: [], reviewBuckets: REQUESTS.reviewBuckets.map((b) => ({ ...b, n: 0 })), reviewedCount: 0, medianMinutesToReview: null });
    await openRequests();
    const section = screen.getByRole("region", { name: "Staff decisions on suggestions" });
    expect(within(section).getByText("No reviewed suggestions in this range.")).toBeTruthy();
    expect(screen.getByText("No reviews in this range.")).toBeTruthy();
  });

  it("an older server without the new fields still shows the agreement table and the median", async () => {
    const { kept: _k, reviewBuckets: _b, ...older } = REQUESTS;
    api.set("GET /api/admin/reports/requests", older);
    await openRequests();
    expect(screen.queryByRole("region", { name: "Staff decisions on suggestions" })).toBeNull();
    expect(screen.getByText("Median time to review: 13 h 4 min (12 reviewed).")).toBeTruthy();
  });

  it("a report failure falls to the tab's Try again", async () => {
    api.set("GET /api/admin/reports/requests", respond(500, { error: "internal", message: "x" }));
    renderAt("/admin");
    await userEvent.setup().click(await screen.findByRole("tab", { name: "Requests" }));
    expect(await screen.findByText("Reports could not be loaded.")).toBeTruthy();
  });
});
