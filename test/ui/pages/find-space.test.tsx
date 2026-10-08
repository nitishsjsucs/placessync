import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateResources } from "../../../src/shared/synthetic/resources.ts";
import { HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { FakeWebSocket } from "../fake-ws.ts";
import { renderAt } from "../render-app.tsx";

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

async function openPage(post: unknown) {
  const api = installFakeApi({
    "GET /api/health": HEALTH,
    "GET /api/me": me("emp_001", "employee"),
    "GET /api/sites/hq/availability": (c: { url: string }) => availability(c.url),
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
  });

  it("shows the conflict on a 409 and refreshes availability", async () => {
    const { api, user } = await openPage(respond(409, { error: "resource_conflict", message: "taken", conflicts: [{ startMin: 540, endMin: 600 }] }));
    await user.click(await screen.findByRole("gridcell", { name: "Desk 2A-01, 09:00 to 09:30, available" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("gridcell", { name: "Desk 2A-01, 09:30 to 10:00, available" }));
    await user.keyboard("{/Shift}");
    await user.click(screen.getByRole("button", { name: /^Book Desk 2A-01/ }));
    const before = availabilityCalls(api).length;
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Confirm booking" }));
    expect(await screen.findByText(/Someone else booked this first: 09:00 to 10:00 is taken/)).toBeTruthy();
    await waitFor(() => expect(availabilityCalls(api).length).toBeGreaterThan(before));
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
  });

  it("validates inline with the shared rules before posting (desk under 60 minutes)", async () => {
    const { api, user } = await openPage(respond(500, {}));
    await user.click(await screen.findByRole("gridcell", { name: "Desk 2A-01, 09:00 to 09:30, available" }));
    await user.click(screen.getByRole("button", { name: /^Book Desk 2A-01/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert").textContent).toContain("A desk booking lasts 60 to 600 minutes.");
    expect((within(dialog).getByRole("button", { name: "Confirm booking" }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);
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
});
