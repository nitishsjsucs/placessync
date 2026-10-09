import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEALTH, type FakeApi, installFakeApi, me, respond } from "../fake-api.ts";
import { FakeWebSocket } from "../fake-ws.ts";
import { renderAt } from "../render-app.tsx";

const base = {
  siteId: "hq",
  reporterId: "emp_001",
  reporterName: "Noah Yamamoto",
  resourceId: "res_sequoia",
  resourceName: "Sequoia",
  locationNote: "",
  description: "Projector shows no signal from the HDMI cable.",
  triageAttempts: 1,
  finalCategory: null,
  reviewDecision: null,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: "2026-10-08T14:00:00.000Z",
  updatedAt: "2026-10-08T14:00:00.000Z",
  ageMinutes: 60,
};
const suggested = { ...base, id: "req_s", title: "Projector dead", status: "awaiting_review", triageState: "suggested", suggestion: { category: "electrical_av", confidence: 0.82, rationale: "Projector.", provider: "stub", model: "keyword-v1", attempts: 1, latencyMs: 0, createdAt: "x" } };
const pending = { ...base, id: "req_p", title: "Odd smell", status: "submitted", triageState: "pending", suggestion: null };
const unavailable = { ...base, id: "req_u", title: "Wobbly table", status: "awaiting_review", triageState: "unavailable", suggestion: null };

let queue: unknown[];
let api: FakeApi;

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  queue = [suggested, pending, unavailable];
  api = installFakeApi({
    "GET /api/health": HEALTH,
    "GET /api/me": me("emp_093", "facilities_staff"),
    "GET /api/staff/requests": () => ({ requests: queue }),
    "GET /api/staff/requests?status=assigned": { requests: [] },
    "GET /api/staff/requests?status=in_progress": { requests: [] },
    "GET /api/staff/requests?status=resolved": { requests: [] },
    "POST /api/staff/requests/req_s/review": { request: {} },
    "GET /api/staff/bookings": {
      date: "2026-10-08",
      bookings: [{ id: "rsv_1", resourceId: "res_alder", resourceName: "Alder", kind: "room", employeeId: "emp_001", employeeName: "Noah Yamamoto", startMin: 600, endMin: 660, attendees: 4, title: "Planning" }],
    },
    "POST /api/staff/requests/req_p/review": { request: {} },
  });
});
afterEach(() => vi.unstubAllGlobals());

const rowOf = (title: string) => screen.getByRole("link", { name: title }).closest("tr") as HTMLElement;

describe("Staff dashboard (SPEC 14.1)", () => {
  it("renders suggestion, confidence and provider label; pending and unavailable rows offer only Categorize", async () => {
    renderAt("/staff");
    await screen.findByRole("link", { name: "Projector dead" });
    const s = rowOf("Projector dead");
    expect(within(s).getByText(/Electrical and AV, 82% confidence/)).toBeTruthy();
    expect(within(s).getByText("Keyword stub (keyword-v1)")).toBeTruthy();
    expect(within(s).getAllByRole("button").map((b) => b.textContent)).toEqual(["Accept suggestion for Projector dead", "Reassign Projector dead"]);
    for (const title of ["Odd smell", "Wobbly table"]) {
      expect(within(rowOf(title)).getAllByRole("button").map((b) => b.textContent)).toEqual([`Categorize ${title}`]);
    }
    expect(within(rowOf("Odd smell")).getByText("Classification pending")).toBeTruthy();
    expect(within(rowOf("Wobbly table")).getByText("Automatic classification unavailable")).toBeTruthy();
  });

  it("does not show a suggestion that arrived after the hand-off to staff", async () => {
    // The sweep handed this request to staff; the Workflow's late suggestion is stored
    // but a manual categorization must not have seen it.
    queue = [{ ...unavailable, suggestion: { ...suggested.suggestion, category: "furniture_fixtures", rationale: "Late answer." } }];
    renderAt("/staff");
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "Wobbly table" });
    const row = rowOf("Wobbly table");
    expect(within(row).getByText("Automatic classification unavailable")).toBeTruthy();
    expect(within(row).queryByText(/confidence/)).toBeNull();
    expect(within(row).queryByText("Keyword stub (keyword-v1)")).toBeNull();
    await user.click(within(row).getByRole("button", { name: /^Categorize/ }));
    const dialog = screen.getByRole("dialog", { name: "Categorize the request" });
    expect(within(dialog).queryByText(/Suggested:/)).toBeNull();
    expect(within(dialog).queryByText(/Late answer/)).toBeNull();
  });

  it("accept, reassign and categorize call the review API", async () => {
    renderAt("/staff");
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "Projector dead" });
    await user.click(within(rowOf("Projector dead")).getByRole("button", { name: /^Accept/ }));
    await user.click(within(screen.getByRole("dialog", { name: "Accept the suggestion?" })).getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(api.calls.some((c) => c.url === "/api/staff/requests/req_s/review")).toBe(true));
    expect(api.calls.find((c) => c.url === "/api/staff/requests/req_s/review")?.body).toEqual({ decision: "accept" });

    await user.click(within(rowOf("Projector dead")).getByRole("button", { name: /^Reassign/ }));
    const dialog = screen.getByRole("dialog", { name: "Reassign the category" });
    const combo = within(dialog).getByRole("combobox", { name: "Category" });
    await user.clear(combo);
    await user.type(combo, "furn");
    await user.keyboard("{Enter}");
    await user.click(within(dialog).getByRole("button", { name: "Save category" }));
    await waitFor(() => expect(api.calls.filter((c) => c.url === "/api/staff/requests/req_s/review")).toHaveLength(2));
    expect(api.calls.filter((c) => c.url === "/api/staff/requests/req_s/review")[1]?.body).toEqual({ decision: "reassign", category: "furniture_fixtures" });

    await user.click(within(rowOf("Odd smell")).getByRole("button", { name: /^Categorize/ }));
    const cat = screen.getByRole("dialog", { name: "Categorize the request" });
    await user.type(within(cat).getByRole("combobox", { name: "Category" }), "clean");
    await user.keyboard("{Enter}");
    await user.click(within(cat).getByRole("button", { name: "Save category" }));
    await waitFor(() => expect(api.calls.find((c) => c.url === "/api/staff/requests/req_p/review")?.body).toEqual({ decision: "categorize", category: "cleaning_safety" }));
  });

  it("shows Already reviewed on a 409 not_reviewable and refreshes", async () => {
    api.set("POST /api/staff/requests/req_s/review", respond(409, { error: "not_reviewable", message: "x" }));
    renderAt("/staff");
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "Projector dead" });
    const before = api.calls.filter((c) => c.url === "/api/staff/requests").length;
    await user.click(within(rowOf("Projector dead")).getByRole("button", { name: /^Accept/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Accept" }));
    expect(await screen.findByText(/Already reviewed/)).toBeTruthy();
    await waitFor(() => expect(api.calls.filter((c) => c.url === "/api/staff/requests").length).toBeGreaterThan(before));
  });

  it("subscribes to staff events and a live staff_event inserts a row", async () => {
    renderAt("/staff");
    await screen.findByRole("link", { name: "Projector dead" });
    const ws = FakeWebSocket.last();
    await act(async () => ws.open());
    expect(ws.sent).toContainEqual({ type: "subscribe_staff" });
    queue = [...queue, { ...suggested, id: "req_new", title: "Lights out in Alder" }];
    await act(async () => ws.receive({ type: "staff_event", event: "triage_ready", requestId: "req_new", category: "electrical_av" }));
    expect(await screen.findByRole("link", { name: "Lights out in Alder" })).toBeTruthy();
  });

  it("shows today's bookings with employee names (Tier 2)", async () => {
    renderAt("/staff");
    await screen.findByRole("link", { name: "Projector dead" });
    await userEvent.setup().click(screen.getByRole("tab", { name: "Today's bookings" }));
    const table = await screen.findByRole("table", { name: "Bookings today, 2026-10-08" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(2));
    expect(within(table).getAllByRole("cell").map((c) => c.textContent)).toEqual(["10:00 to 11:00", "Alder", "Noah Yamamoto", "4 attending, Planning"]);
  });
});
