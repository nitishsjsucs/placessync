import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateResources } from "../../../src/shared/synthetic/resources.ts";
import { HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { FakeWebSocket } from "../fake-ws.ts";
import { renderAt, renderAtEntries } from "../render-app.tsx";
import { browserFocusFixup, setMediaMatches } from "../setup.ts";

const RESOURCES = generateResources();
const DATE = "2026-10-12";

function availability(url: string, busy: Record<string, { startMin: number; endMin: number; mine: boolean }[]> = {}, version = 1) {
  const params = new URL(url, "http://x").searchParams;
  const kind = params.get("kind");
  const resources = RESOURCES.filter((r) => !kind || r.kind === kind).map((resource) => ({
    resource,
    busy: busy[resource.id] ?? [],
    freeWindows: [],
    fitsWindow: true,
  }));
  return { date: params.get("date"), version, ledgerVersion: version, resources };
}

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  // Thursday 2026-10-08 08:00 in Los Angeles, so 2026-10-12 is bookable.
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T15:00:00Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function openPage(post: unknown, busy: Parameters<typeof availability>[1] = {}) {
  const api = installFakeApi({
    "GET /api/health": HEALTH,
    "GET /api/me": me("emp_001", "employee"),
    "GET /api/sites/hq/availability": (c: { url: string }) => availability(c.url, busy),
    "POST /api/reservations": post,
  });
  renderAt("/find");
  await screen.findByRole("heading", { level: 1, name: "Find a space" });
  const user = userEvent.setup();
  // Pick Monday 2026-10-12 in the DateGrid.
  await user.click(await screen.findByRole("gridcell", { name: "Monday, October 12, 2026" }));
  await waitFor(() => expect(api.calls.some((c) => c.url.includes(`date=${DATE}`))).toBe(true));
  return { api, user };
}

const availabilityCalls = (api: { calls: { url: string }[] }) => api.calls.filter((c) => c.url.startsWith("/api/sites/hq/availability"));

describe("Find a space (SPEC 14.1)", () => {
  it("filters, picks a date, selects a slot, confirms in the dialog, POSTs and announces", async () => {
    const { api, user } = await openPage((c: { body: { resourceId: string; date: string; startMin: number; endMin: number } }) =>
      respond(201, {
        reservation: { id: "rsv_1", employeeId: "emp_001", kind: "room", attendees: 3, title: null, status: "confirmed", createdAt: "x", cancelledAt: null, cancelledBy: null, cancelReason: null, version: 1, ...c.body },
        version: 1,
        dateVersion: 1,
      }),
    );
    await user.click(screen.getByRole("tab", { name: "Rooms" }));
    await waitFor(() => expect(availabilityCalls(api).at(-1)?.url).toContain("kind=room"));
    await screen.findByRole("gridcell", { name: "Sequoia (8), 09:00 to 09:30, available" });
    expect(screen.queryByRole("gridcell", { name: /Desk 2A-01/ })).toBeNull();

    await user.click(screen.getByRole("gridcell", { name: "Sequoia (8), 09:00 to 09:30, available" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("gridcell", { name: "Sequoia (8), 09:30 to 10:00, available" }));
    await user.keyboard("{/Shift}");
    await user.click(screen.getByRole("button", { name: /^Book Sequoia/ }));
    const dialog = await screen.findByRole("dialog", { name: "Book Sequoia" });
    const attendees = within(dialog).getByRole("spinbutton", { name: /Attendees/ });
    await user.clear(attendees);
    await user.type(attendees, "3");
    await user.click(within(dialog).getByRole("button", { name: "Confirm booking" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const post = api.calls.find((c) => c.method === "POST" && c.url === "/api/reservations");
    expect(post?.body).toMatchObject({ resourceId: "res_sequoia", date: DATE, startMin: 540, attendees: 3 });
    expect(post?.headers["idempotency-key"]).toMatch(/^web-/);
    await waitFor(() => expect(screen.getByTestId("announcer").textContent).toMatch(/^Booked Sequoia on Monday, October 12, 2026, 09:00 to/));
    // A visible result with a next step takes focus, since the Book button is now disabled.
    const banner = screen.getByTestId("status-banner");
    expect(banner.textContent).toContain("Booked Sequoia on Monday, October 12, 2026, 09:00 to 10:00.");
    expect(within(banner).getByRole("link", { name: "See My bookings" }).getAttribute("href")).toBe("/bookings");
    expect(document.activeElement).toBe(banner);
  });

  it("shows the conflict on a 409, refreshes availability, and Pick another time returns to that row", async () => {
    const { api, user } = await openPage(respond(409, { error: "resource_conflict", message: "taken", conflicts: [{ startMin: 540, endMin: 600 }] }));
    await user.click(await screen.findByRole("gridcell", { name: "Desk 2A-01, 09:00 to 09:30, available" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("gridcell", { name: "Desk 2A-01, 09:30 to 10:00, available" }));
    await user.keyboard("{/Shift}");
    await user.click(screen.getByRole("button", { name: /^Book Desk 2A-01/ }));
    const before = availabilityCalls(api).length;
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Confirm booking" }));
    // The sentence is the one DEMO.md quotes.
    expect(await screen.findByText("Someone else booked this first: 09:00 to 10:00 is taken. The grid has been refreshed; pick another time.")).toBeTruthy();
    await waitFor(() => expect(availabilityCalls(api).length).toBeGreaterThan(before));
    expect(within(dialog).queryByRole("button", { name: "Confirm booking" })).toBeNull();
    const pick = within(dialog).getByRole("button", { name: "Pick another time" });
    expect(document.activeElement).toBe(pick);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    await user.click(pick);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const focused = document.activeElement as HTMLElement;
    expect(focused.getAttribute("role")).toBe("gridcell");
    expect(focused.dataset.row).toBe("res_2a01");
    expect(focused.dataset.start).toBe("540");
    expect(api.calls.filter((c) => c.method === "POST" && c.url === "/api/reservations")).toHaveLength(1);
  });

  it("after a 409 employee_conflict links to My bookings and keeps Confirm disabled", async () => {
    const { api, user } = await openPage(respond(409, { error: "employee_conflict", message: "yours", conflicts: [{ startMin: 600, endMin: 660 }] }));
    await user.click(await screen.findByRole("gridcell", { name: "Desk 2A-01, 10:00 to 10:30, available" }));
    await user.click(screen.getByRole("button", { name: /^Book Desk 2A-01/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Confirm booking" }));
    const message = await within(dialog).findByText(/You already have a desk booked at that time \(10:00 to 11:00\)\./);
    expect(document.activeElement).toBe(message);
    expect(within(dialog).getByRole("link", { name: "See my bookings" }).getAttribute("href")).toBe("/bookings");
    const confirm = within(dialog).getByRole("button", { name: "Confirm booking" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await user.click(confirm);
    expect(api.calls.filter((c) => c.method === "POST" && c.url === "/api/reservations")).toHaveLength(1);
  });

  it("shows a visible notice when a live update takes the selection, until the next selection", async () => {
    const { user } = await openPage(respond(500, {}));
    const ws = FakeWebSocket.instances.at(-1) as FakeWebSocket;
    await act(async () => ws.open());
    const busy = Object.fromEntries(RESOURCES.map((r) => [r.id, [] as unknown[]]));
    await act(async () => ws.receive({ type: "snapshot", date: DATE, dateVersion: 1, ledgerVersion: 1, busy }));
    await user.click(await screen.findByRole("gridcell", { name: "Desk 2A-02, 10:00 to 10:30, available" }));
    await act(async () =>
      ws.receive({ type: "delta", date: DATE, dateVersion: 2, ledgerVersion: 2, op: "booked", resourceId: "res_2a02", startMin: 600, endMin: 660, mine: false }),
    );
    const text = "10:00 to 11:00 on Desk 2A-02 was just booked by someone else. Pick another time.";
    expect(await screen.findByText(text, { selector: "p" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select a time to book" })).toBeTruthy();
    await user.click(screen.getByRole("gridcell", { name: "Desk 2A-03, 10:00 to 10:30, available" }));
    expect(screen.queryByText(text, { selector: "p" })).toBeNull();
  });

  it("maps 422 issues to the dialog fields", async () => {
    const { user } = await openPage(respond(422, { error: "validation", message: "bad", issues: [{ path: "attendees", code: "over_capacity", message: "This room holds 8." }] }));
    await user.click(screen.getByRole("tab", { name: "Rooms" }));
    await user.click(await screen.findByRole("gridcell", { name: "Sequoia (8), 09:00 to 09:30, available" }));
    await user.click(screen.getByRole("button", { name: /^Book Sequoia/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Confirm booking" }));
    const field = within(dialog).getByRole("spinbutton", { name: /Attendees/ });
    await waitFor(() => expect(field.getAttribute("aria-invalid")).toBe("true"));
    expect(within(dialog).getByText("This room holds 8.")).toBeTruthy();
    // Focus goes to the field to correct.
    expect(document.activeElement).toBe(field);
  });

  it("a booking that could not be saved keeps focus in the dialog, on the message", async () => {
    let fail: (() => void) | null = null;
    const { user } = await openPage(() => new Promise((resolve) => (fail = () => resolve(respond(503, { error: "unavailable", message: "x" })))));
    await user.click(await screen.findByRole("gridcell", { name: "Desk 2A-01, 10:00 to 10:30, available" }));
    await user.click(screen.getByRole("button", { name: /^Book Desk 2A-01/ }));
    const dialog = await screen.findByRole("dialog");
    await user.keyboard("{Enter}");
    browserFocusFixup();
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    await act(async () => fail?.());
    const message = await within(dialog).findByText("The booking could not be saved. Try again.");
    expect(document.activeElement).toBe(message);
  });

  // The fake below keeps the ledger's idempotency contract (SPEC 7.1): a key is bound to
  // the first body it carried, and a different body under it gives idempotency_key_reuse.
  function ledgerLikePost(answer: (body: { attendees: number }, n: number) => unknown) {
    const seen = new Map<string, string>();
    let n = 0;
    return (c: { body: { attendees: number; resourceId: string; date: string; startMin: number; endMin: number }; headers: Record<string, string> }) => {
      const key = c.headers["idempotency-key"] ?? "";
      const body = JSON.stringify(c.body);
      const prior = seen.get(key);
      if (prior !== undefined && prior !== body) return respond(422, { error: "idempotency_key_reuse", message: "This Idempotency-Key was already used for a different request." });
      seen.set(key, body);
      n += 1;
      const out = answer(c.body, n);
      if (out !== "ok") return out;
      return respond(201, {
        reservation: { id: `rsv_${n}`, employeeId: "emp_001", kind: "room", title: null, status: "confirmed", createdAt: "x", cancelledAt: null, cancelledBy: null, cancelReason: null, version: 1, ...c.body },
        version: 1,
        dateVersion: 1,
      });
    };
  }

  async function openSequoiaDialog(post: unknown) {
    const { api, user } = await openPage(post);
    await user.click(screen.getByRole("tab", { name: "Rooms" }));
    await user.click(await screen.findByRole("gridcell", { name: "Sequoia (8), 09:00 to 09:30, available" }));
    await user.click(screen.getByRole("button", { name: /^Book Sequoia/ }));
    const dialog = await screen.findByRole("dialog");
    const attendees = within(dialog).getByRole("spinbutton", { name: /Attendees/ });
    return { api, user, dialog, attendees };
  }

  const posts = (api: { calls: { method: string; url: string; body: unknown; headers: Record<string, string> }[] }) =>
    api.calls.filter((c) => c.method === "POST" && c.url === "/api/reservations");

  it("after a 422, a corrected resubmit gets a new Idempotency-Key and succeeds", async () => {
    const { api, user, dialog, attendees } = await openSequoiaDialog(
      ledgerLikePost((body) =>
        body.attendees > 4 ? respond(422, { error: "validation", message: "bad", issues: [{ path: "attendees", code: "over_capacity", message: "Too many people for this booking." }] }) : "ok",
      ),
    );
    await user.clear(attendees);
    await user.type(attendees, "6");
    await user.click(within(dialog).getByRole("button", { name: "Confirm booking" }));
    expect(await within(dialog).findByText("Too many people for this booking.")).toBeTruthy();

    await user.clear(attendees);
    await user.type(attendees, "3");
    await user.click(within(dialog).getByRole("button", { name: "Confirm booking" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const [first, second] = posts(api);
    expect(first?.body).toMatchObject({ attendees: 6 });
    expect(second?.body).toMatchObject({ attendees: 3 });
    expect(second?.headers["idempotency-key"]).toMatch(/^web-/);
    expect(second?.headers["idempotency-key"]).not.toBe(first?.headers["idempotency-key"]);
    await waitFor(() => expect(screen.getByTestId("announcer").textContent).toMatch(/^Booked Sequoia/));
  });

  it("retries an unanswered request with the same body under the same Idempotency-Key", async () => {
    const { api, user, dialog } = await openSequoiaDialog(ledgerLikePost((_body, n) => (n === 1 ? respond(503, { error: "unavailable", message: "try again" }) : "ok")));
    await user.click(within(dialog).getByRole("button", { name: "Confirm booking" }));
    expect(await within(dialog).findByText("The booking could not be saved. Try again.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Confirm booking" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const [first, second] = posts(api);
    expect(second?.body).toEqual(first?.body);
    expect(second?.headers["idempotency-key"]).toBe(first?.headers["idempotency-key"]);
  });

  it("validates inline with the shared rules before posting (desk under 60 minutes)", async () => {
    // 09:30 is taken, so a click on 09:00 can only select one 30-minute cell.
    const { api, user } = await openPage(respond(500, {}), { res_2a01: [{ startMin: 570, endMin: 600, mine: false }] });
    await user.click(await screen.findByRole("gridcell", { name: "Desk 2A-01, 09:00 to 09:30, available" }));
    expect(screen.getByText("Desks need at least 60 minutes; extend the selection.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Book Desk 2A-01, 09:00 to 09:30" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert").textContent).toContain("A desk booking lasts 60 to 600 minutes.");
    expect((within(dialog).getByRole("button", { name: "Confirm booking" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
    // Confirm is disabled, so the dialog opens on the reason; Escape closes it.
    expect(document.activeElement).toBe(within(dialog).getByRole("alert"));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /^Book Desk 2A-01/ }));
  });

  it("one click on a desk selects an hour, and Book opens a dialog whose Confirm is enabled", async () => {
    const { user } = await openPage(respond(500, {}));
    await user.click(await screen.findByRole("gridcell", { name: "Desk 2A-01, 10:00 to 10:30, available" }));
    expect(screen.queryByText(/need at least 60 minutes/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Book Desk 2A-01, 10:00 to 11:00" }));
    const dialog = await screen.findByRole("dialog", { name: "Book Desk 2A-01" });
    const confirm = within(dialog).getByRole("button", { name: "Confirm booking" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(false);
    expect(document.activeElement).toBe(confirm);
    expect(within(dialog).queryByRole("alert")).toBeNull();
  });

  it("a click then Shift+click still gives the range between them", async () => {
    const { user } = await openPage(respond(500, {}));
    await user.click(await screen.findByRole("gridcell", { name: "Desk 2A-01, 10:00 to 10:30, available" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("gridcell", { name: "Desk 2A-01, 10:30 to 11:00, available" }));
    await user.keyboard("{/Shift}");
    expect(screen.getByRole("button", { name: "Book Desk 2A-01, 10:00 to 11:00" })).toBeTruthy();
  });

  it("applies live deltas from the socket to the grid", async () => {
    await openPage(respond(500, {}));
    const ws = FakeWebSocket.instances.at(-1) as FakeWebSocket;
    await act(async () => ws.open());
    expect(ws.subscriptions()).toContain(DATE);
    const busy = Object.fromEntries(RESOURCES.map((r) => [r.id, [] as unknown[]]));
    await act(async () => ws.receive({ type: "snapshot", date: DATE, dateVersion: 1, ledgerVersion: 1, busy }));
    await act(async () =>
      ws.receive({ type: "delta", date: DATE, dateVersion: 2, ledgerVersion: 2, op: "booked", resourceId: "res_2a02", startMin: 600, endMin: 660, mine: false }),
    );
    expect(await screen.findByRole("gridcell", { name: "Desk 2A-02, 10:00 to 10:30, booked" })).toBeTruthy();
    expect(screen.getByText("Live updates on")).toBeTruthy();
  });

  it("a failed availability load offers Try again, which refetches and renders the grid", async () => {
    let failures = 1;
    const api = installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/sites/hq/availability": (c: { url: string }) => (failures-- > 0 ? respond(500, { error: "internal", message: "x" }) : availability(c.url)),
    });
    renderAt("/find");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Availability could not be loaded.");
    expect(screen.queryByRole("grid", { name: /^Availability on/ })).toBeNull();
    const before = availabilityCalls(api).length;
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("grid", { name: /^Availability on/ })).toBeTruthy();
    expect(availabilityCalls(api).length).toBe(before + 1);
    expect(screen.queryByText("Availability could not be loaded.")).toBeNull();
    // Focus is on the slot area that replaced the message, not on nothing.
    expect(document.activeElement).toBe(document.getElementById("slots"));
  });
});

describe("Find a space keeps its search in the URL (UX-04)", () => {
  function fakes() {
    return installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/sites/hq/availability": (c: { url: string }) => availability(c.url),
      "GET /api/resources/res_sequoia/calendar": (c: { url: string }) => {
        const weekStart = new URL(c.url, "http://x").searchParams.get("weekStart") ?? "";
        return { resource: RESOURCES.find((r) => r.id === "res_sequoia"), days: Array.from({ length: 7 }, (_, i) => ({ date: addDaysLocal(weekStart, i), busy: [] })) };
      },
    });
  }
  const addDaysLocal = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const lastQuery = (api: { calls: { url: string }[] }) => new URL(availabilityCalls(api).at(-1)?.url ?? "", "http://x").searchParams;

  it("restores the date, tab and filters from the URL and sends them to the API", async () => {
    const api = fakes();
    renderAt("/find?date=2026-10-12&kind=desk&floor=3");
    await screen.findByRole("heading", { level: 1, name: "Find a space" });
    await waitFor(() => expect(availabilityCalls(api).length).toBeGreaterThan(0));
    expect(Object.fromEntries(lastQuery(api))).toEqual({ date: "2026-10-12", kind: "desk", floor: "3" });
    expect(screen.getByRole("gridcell", { name: "Monday, October 12, 2026" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Desks" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByRole("combobox", { name: "Floor" }) as HTMLSelectElement).value).toBe("3");
    expect(await screen.findByText("Monday, October 12, 2026", { exact: false, selector: "p" })).toBeTruthy();
  });

  it("writes every change with replace, so Back leaves the page", async () => {
    fakes();
    const { router } = renderAtEntries(["/bookings", "/find"]);
    await screen.findByRole("heading", { level: 1, name: "Find a space" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("gridcell", { name: "Monday, October 12, 2026" }));
    await user.click(screen.getByRole("tab", { name: "Rooms" }));
    await user.selectOptions(screen.getByRole("combobox", { name: "Floor" }), "2");
    await user.click(screen.getByRole("checkbox", { name: "Whiteboard" }));
    await waitFor(() => expect(Object.fromEntries(new URLSearchParams(router.state.location.search))).toEqual({ date: "2026-10-12", kind: "room", floor: "2", amenity: "whiteboard" }));
    expect(router.state.historyAction).toBe("REPLACE");
    await router.navigate(-1);
    await waitFor(() => expect(router.state.location.pathname).toBe("/bookings"));
  });

  it.each([
    ["a Saturday", "2026-10-10"],
    ["a past date", "2026-10-01"],
    ["a date beyond the horizon", "2026-10-30"],
    ["garbage", "garbage"],
  ])("falls back to the first bookable date for %s", async (_label, bad) => {
    const api = fakes();
    renderAt(`/find?date=${bad}&kind=boat&from=600&to=540&floor=9&minCapacity=3&amenity=whiteboard,jacuzzi`);
    await screen.findByRole("heading", { level: 1, name: "Find a space" });
    await waitFor(() => expect(availabilityCalls(api).length).toBeGreaterThan(0));
    // Thursday 2026-10-08 at 08:00 site time: today is bookable.
    expect(Object.fromEntries(lastQuery(api))).toEqual({ date: "2026-10-08", amenity: "whiteboard" });
    expect(screen.getByRole("tab", { name: "All spaces" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByRole("combobox", { name: "Free from" }) as HTMLSelectElement).value).toBe("");
    expect((screen.getByRole("combobox", { name: "Until" }) as HTMLSelectElement).value).toBe("");
  });

  it("week-calendar links carry the selected date, and Back from a week calendar restores the search", async () => {
    fakes();
    const { router } = renderAt("/find?date=2026-10-12&kind=room");
    const user = userEvent.setup();
    await screen.findByRole("gridcell", { name: "Sequoia (8), 09:00 to 09:30, available" });
    await user.click(screen.getByText("Week calendars"));
    const link = screen.getByRole("link", { name: "Sequoia" });
    expect(link.getAttribute("href")).toBe("/resources/res_sequoia?date=2026-10-12");
    await user.click(link);
    expect(await screen.findByRole("grid", { name: /Sequoia, week of Monday, October 12, 2026/ })).toBeTruthy();
    await router.navigate(-1);
    await screen.findByRole("heading", { level: 1, name: "Find a space" });
    expect(screen.getByRole("tab", { name: "Rooms" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "Monday, October 12, 2026" }).getAttribute("aria-selected")).toBe("true");
  });
});

describe("Find a space opens on a date that can still be booked (UX-01)", () => {
  // Site-local Thursday 2026-10-08 (UTC-7) at the given time.
  const at = (hh: number, mm: number) => Date.parse("2026-10-08T00:00:00Z") + ((hh + 7) * 60 + mm) * 60_000;

  async function openAt(hh: number, mm: number) {
    vi.spyOn(Date, "now").mockReturnValue(at(hh, mm));
    const api = installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/sites/hq/availability": (c: { url: string }) => availability(c.url),
    });
    renderAt("/find");
    await screen.findByRole("heading", { level: 1, name: "Find a space" });
    await waitFor(() => expect(availabilityCalls(api).length).toBeGreaterThan(0));
    await screen.findByText(/spaces on/);
    return api;
  }

  it("at 20:00 opens on Friday, says why, and asks for Friday's availability", async () => {
    const api = await openAt(20, 0);
    expect(availabilityCalls(api).at(-1)?.url).toContain("date=2026-10-09");
    expect(screen.getByRole("gridcell", { name: "Friday, October 9, 2026" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Bookings for today have closed; showing Friday, October 9, 2026.")).toBeTruthy();
  });

  it("at 18:45 opens on Friday", async () => {
    const api = await openAt(18, 45);
    expect(availabilityCalls(api).at(-1)?.url).toContain("date=2026-10-09");
  });

  it.each([
    [18, 0],
    [8, 0],
  ])("at %i:%i opens on today with no closed line", async (hh, mm) => {
    const api = await openAt(hh, mm);
    expect(availabilityCalls(api).at(-1)?.url).toContain("date=2026-10-08");
    expect(screen.queryByText(/Bookings for today have closed/)).toBeNull();
  });

  it("stays on the date it opened on when the clock passes 18:30 with a selection made", async () => {
    const api = await openAt(18, 20);
    const user = userEvent.setup();
    await user.click(screen.getByRole("gridcell", { name: "Sequoia (8), 18:30 to 19:00, available" }));
    const book = screen.getByRole("button", { name: "Book Sequoia, 18:30 to 19:00" });
    // 18:31: no slot can start today any more, which used to move the open page to Friday.
    vi.spyOn(Date, "now").mockReturnValue(at(18, 31));
    await user.click(book);
    const dialog = await screen.findByRole("dialog", { name: "Book Sequoia" });
    expect(within(dialog).getByText("Thursday, October 8, 2026")).toBeTruthy();
    expect(within(dialog).getByRole("alert").textContent).toContain("That start time has already passed.");
    expect((within(dialog).getByRole("button", { name: "Confirm booking" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("gridcell", { name: "Thursday, October 8, 2026" }).getAttribute("aria-selected")).toBe("true");
    expect(availabilityCalls(api).every((c) => c.url.includes("date=2026-10-08"))).toBe(true);
    expect(screen.queryByText(/Bookings for today have closed/)).toBeNull();
  });

  it("clears the selection whenever the date changes, including through the address", async () => {
    vi.spyOn(Date, "now").mockReturnValue(at(8, 0));
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/sites/hq/availability": (c: { url: string }) => availability(c.url),
    });
    const { router } = renderAt("/find?date=2026-10-12");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("gridcell", { name: "Desk 2A-01, 10:00 to 10:30, available" }));
    expect(screen.getByRole("button", { name: "Book Desk 2A-01, 10:00 to 11:00" })).toBeTruthy();
    await act(async () => {
      await router.navigate("/find?date=2026-10-13");
    });
    expect(await screen.findByText("Tuesday, October 13, 2026", { exact: false, selector: "p" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Select a time to book" })).toBeTruthy();
  });
});

describe("Find a space below 1024 px puts availability first (UX-12)", () => {
  function fakes() {
    return installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/sites/hq/availability": (c: { url: string }) =>
        new URL(c.url, "http://x").searchParams.get("q") === "zzz" ? { ...availability(c.url), resources: [] } : availability(c.url),
    });
  }

  it("starts with the filters collapsed behind a Filters button that counts active filters; Clear filters resets them", async () => {
    setMediaMatches("(max-width: 1023px)", true);
    const api = fakes();
    const { router } = renderAt("/find");
    await screen.findByRole("grid", { name: /^Availability on/ });
    const toggle = screen.getByRole("button", { name: "Filters" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const fieldset = document.getElementById(toggle.getAttribute("aria-controls") ?? "") as HTMLElement;
    expect(fieldset.hidden).toBe(true);
    expect(screen.queryByRole("combobox", { name: "Floor" })).toBeNull();
    // Date picker, then filters, then results, in the DOM as on screen.
    const dateGrid = screen.getByRole("grid", { name: /^Booking date/ });
    const slots = screen.getByRole("grid", { name: /^Availability on/ });
    expect(dateGrid.compareDocumentPosition(toggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(toggle.compareDocumentPosition(slots) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const user = userEvent.setup();
    await user.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(fieldset.hidden).toBe(false);
    await user.selectOptions(screen.getByRole("combobox", { name: "Floor" }), "3");
    await user.click(screen.getByRole("checkbox", { name: "Whiteboard" }));
    expect(await screen.findByRole("button", { name: "Filters (2 active)" })).toBeTruthy();
    await waitFor(() => expect(availabilityCalls(api).at(-1)?.url).toContain("floor=3"));
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(await screen.findByRole("button", { name: "Filters" })).toBeTruthy();
    await waitFor(() => expect(router.state.location.search).toBe(""));
    // Clear filters is gone with the filters; focus is on the toggle that opened them.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Filters" }));
    const last = availabilityCalls(api).at(-1)?.url ?? "";
    expect(last).not.toContain("floor=");
    expect(last).not.toContain("amenity=");
  });

  it("at 1024 px and wider shows the filters as before, with no toggle", async () => {
    fakes();
    renderAt("/find");
    await screen.findByRole("grid", { name: /^Availability on/ });
    expect(screen.queryByRole("button", { name: /^Filters/ })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Floor" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Clear filters" })).toBeNull();
  });

  it("the no-match state offers Clear filters at every width", async () => {
    const api = fakes();
    renderAt("/find?q=zzz&floor=2");
    expect(await screen.findByText("No spaces match these filters.")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "Clear filters" }));
    await screen.findByRole("grid", { name: /^Availability on/ });
    expect(availabilityCalls(api).at(-1)?.url).not.toContain("q=");
    expect(document.activeElement).toBe(document.getElementById("slots"));
  });
});

