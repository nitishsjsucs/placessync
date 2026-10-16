import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateResources } from "../../../src/shared/synthetic/resources.ts";
import { type FakeApi, HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { renderAt } from "../render-app.tsx";

let api: FakeApi;
beforeEach(() => {
  api = installFakeApi({
    "GET /api/sites/hq/resources": { resources: generateResources().slice(0, 2).map((r, i) => ({ ...r, active: i === 0 })) },
    "PATCH /api/admin/resources/res_2a01": { resource: { ...generateResources()[0], active: false } },
    "PATCH /api/admin/resources/res_2a02": { resource: { ...generateResources()[1], active: true } },
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
  const cells = (table: HTMLElement) =>
    within(table)
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent));

  it("renders utilization with one row per space by default, and the daily rows on request", async () => {
    renderAt("/admin");
    await screen.findByText("Desk 2A-01");
    const table = screen.getByRole("table", { name: /^Utilization by space, Thursday, September 10, 2026 to Thursday, October 22, 2026$/ });
    // 31 weekdays from 2026-09-10 to 2026-10-22, 720 bookable minutes each.
    expect(cells(table)).toEqual([
      ["Desk 2A-01", "2", "4.0", "1", "1%"],
      ["Redwood", "1", "0.5", "1", "0%"],
    ]);
    expect(screen.getByText(/3 confirmed bookings, 5 booked hours across 2 resource-days/)).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "Show daily rows" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    await userEvent.setup().click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(cells(screen.getByRole("table", { name: /^Utilization, / }))).toEqual([
      ["Desk 2A-01", "2026-10-12", "2", "4.0", "33%"],
      ["Redwood", "2026-10-12", "1", "0.5", "4%"],
    ]);
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
    await screen.findByRole("table", { name: /^Utilization by space/ });
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
    await screen.findByRole("table", { name: /^Utilization by space/ });
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
    await screen.findByRole("table", { name: /^Utilization by space/ });
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
    expect(await screen.findByText("No confirmed bookings in this range yet.")).toBeTruthy();
    await user.click(screen.getByRole("tab", { name: "Resources" }));
    const resourcesAlert = (await screen.findByText("Resources could not be loaded.")).closest("[role=alert]") as HTMLElement;
    await user.click(within(resourcesAlert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("table", { name: "Resources" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Resources could not be loaded.")).toBeNull());
  });
});
