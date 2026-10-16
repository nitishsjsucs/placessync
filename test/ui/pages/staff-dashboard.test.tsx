import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEALTH, type FakeApi, installFakeApi, me, respond } from "../fake-api.ts";
import { FakeWebSocket } from "../fake-ws.ts";
import { renderAt } from "../render-app.tsx";
import { browserFocusFixup } from "../setup.ts";

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
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
    const banner = await screen.findByTestId("status-banner");
    expect(banner.textContent).toContain('Assigned "Projector dead". It is now under In progress.');
    expect(within(banner).getByRole("link", { name: "Go to In progress" }).getAttribute("href")).toBe("/staff?tab=working");
    expect(document.activeElement).toBe(banner);

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

  it("shows Already reviewed on a 409 not_reviewable, refreshes, and puts focus on the notice", async () => {
    api.set("POST /api/staff/requests/req_s/review", () => {
      // Someone else reviewed it, so the refresh no longer lists it.
      queue = [pending, unavailable];
      return respond(409, { error: "not_reviewable", message: "x" });
    });
    renderAt("/staff");
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "Projector dead" });
    const before = api.calls.filter((c) => c.url === "/api/staff/requests").length;
    await user.click(within(rowOf("Projector dead")).getByRole("button", { name: /^Accept/ }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Accept" }));
    const notice = await screen.findByText(/Already reviewed/);
    await waitFor(() => expect(api.calls.filter((c) => c.url === "/api/staff/requests").length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByRole("link", { name: "Projector dead" })).toBeNull());
    expect(document.activeElement).toBe(notice);
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

  it("shows today's bookings as a timeline, and with employee names as a table (Tier 2, VIZ-02)", async () => {
    renderAt("/staff");
    await screen.findByRole("link", { name: "Projector dead" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Today's bookings" }));
    const chart = await screen.findByRole("group", { name: "Bookings by space, Thursday, October 8, 2026" });
    expect(within(chart).getAllByRole("listitem")[0]?.getAttribute("aria-label")).toMatch(/^Alder: booked 10:00 to 11:00 \(Noah Yamamoto, 4 attending, Planning\)/);
    await user.click(screen.getByRole("button", { name: "Show as table" }));
    const table = await screen.findByRole("table", { name: "Bookings today, 2026-10-08" });
    await waitFor(() => expect(within(table).getAllByRole("row")).toHaveLength(2));
    expect(within(table).getAllByRole("cell").map((c) => c.textContent)).toEqual(["10:00 to 11:00", "Alder", "Noah Yamamoto", "4 attending, Planning"]);
  });

  it("a failed queue load offers Try again; Today's bookings fails on its own without touching the queue error", async () => {
    let queueFailures = 1;
    let todayFailures = 1;
    api.set("GET /api/staff/requests", () => (queueFailures-- > 0 ? respond(500, { error: "internal", message: "x" }) : { requests: queue }));
    api.set("GET /api/staff/bookings", () =>
      todayFailures-- > 0
        ? respond(500, { error: "internal", message: "x" })
        : { date: "2026-10-08", bookings: [{ id: "rsv_1", resourceId: "res_alder", resourceName: "Alder", kind: "room", employeeId: "emp_001", employeeName: "Noah Yamamoto", startMin: 600, endMin: 660, attendees: 4, title: "Planning" }] },
    );
    renderAt("/staff");
    const user = userEvent.setup();
    const queueAlert = await screen.findByText("The queue could not be loaded.");
    await user.click(screen.getByRole("tab", { name: "Today's bookings" }));
    const todayAlert = await screen.findByText("Today's bookings could not be loaded.");
    // Both errors show, each with its own Try again.
    expect(screen.getByText("The queue could not be loaded.")).toBe(queueAlert);
    expect(screen.getAllByRole("button", { name: "Try again" })).toHaveLength(2);
    await user.click(within(todayAlert.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("group", { name: /^Bookings by space/ })).toBeTruthy();
    expect(screen.getByText("The queue could not be loaded.")).toBeTruthy();
    await user.click(within(queueAlert.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("The queue could not be loaded.")).toBeNull());
    await user.click(screen.getByRole("tab", { name: "Triage queue" }));
    expect(await screen.findByRole("link", { name: "Projector dead" })).toBeTruthy();
  });
});

describe("Staff dashboard stays current and keeps its tab (UX-08)", () => {
  const queueGets = () => api.calls.filter((c) => c.method === "GET" && c.url === "/api/staff/requests");

  it("opens the tab named in ?tab= and writes tab changes with replace; row links remember the tab", async () => {
    api.set("GET /api/staff/requests?status=assigned", { requests: [{ ...suggested, id: "req_w", title: "Chair broken", status: "assigned", finalCategory: "furniture_fixtures" }] });
    const { router } = renderAt("/staff?tab=working");
    expect(await screen.findByRole("table", { name: "Assigned and in progress" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "In progress" }).getAttribute("aria-selected")).toBe("true");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Chair broken" }));
    await screen.findByRole("heading", { level: 1 });
    expect(router.state.location.state).toEqual({ from: "/staff?tab=working" });
    await router.navigate(-1);
    await screen.findByRole("table", { name: "Assigned and in progress" });
    await user.click(screen.getByRole("tab", { name: "Resolved" }));
    await waitFor(() => expect(router.state.location.search).toBe("?tab=resolved"));
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("refetches the queue every 60 s while visible, so a request eligible after 2 minutes appears without an event", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    queue = [suggested];
    renderAt("/staff");
    await screen.findByRole("link", { name: "Projector dead" });
    const before = queueGets().length;
    queue = [suggested, pending];
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(queueGets().length).toBe(before + 1);
    const row = (await screen.findByRole("link", { name: "Odd smell" })).closest("tr") as HTMLElement;
    expect(within(row).getByText("Classification pending")).toBeTruthy();
    expect(within(row).getByRole("button", { name: /^Categorize/ })).toBeTruthy();
    // Only the queue is fetched again, not the other tabs' lists.
    expect(api.calls.filter((c) => c.url.startsWith("/api/staff/requests?status=")).length).toBe(3);
    expect(screen.getByText(/^Updated \d\d:\d\d$/)).toBeTruthy();
  });

  it("makes no timed request while hidden, and refetches when the page becomes visible", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderAt("/staff");
    await screen.findByRole("link", { name: "Projector dead" });
    const before = queueGets().length;
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(180_000));
    expect(queueGets().length).toBe(before);
    visibility.mockReturnValue("visible");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(queueGets().length).toBe(before + 1));
  });

  it("says Connecting at first, Live once the socket opens, and refetches the queue after a reconnect", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderAt("/staff");
    await screen.findByRole("link", { name: "Projector dead" });
    expect(screen.getByText("Connecting to live updates")).toBeTruthy();
    const first = FakeWebSocket.last();
    await act(async () => first.open());
    expect(screen.getByText("Live updates on")).toBeTruthy();
    const before = queueGets().length;
    await act(async () => first.serverClose(1006));
    expect(screen.getByText("Live updates offline, retrying")).toBeTruthy();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    const second = FakeWebSocket.last();
    expect(second).not.toBe(first);
    queue = [...queue, { ...suggested, id: "req_missed", title: "Sent while offline" }];
    await act(async () => second.open());
    expect(await screen.findByRole("link", { name: "Sent while offline" })).toBeTruthy();
    expect(queueGets().length).toBe(before + 1);
  });
});

describe("Resolving and save errors (UX-09)", () => {
  const working = { ...suggested, id: "req_w", title: "Chair broken", status: "in_progress", finalCategory: "furniture_fixtures" };
  const assigned = { ...suggested, id: "req_a", title: "Lamp out", status: "assigned", finalCategory: "electrical_av" };
  const statusPosts = () => api.calls.filter((c) => c.method === "POST" && c.url.endsWith("/status"));
  const rejectFetchFor = (suffix: string) => {
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => (String(input).endsWith(suffix) ? Promise.reject(new TypeError("Failed to fetch")) : realFetch(input, init)));
  };

  async function openWorking() {
    api.set("GET /api/staff/requests?status=in_progress", { requests: [working] });
    api.set("GET /api/staff/requests?status=assigned", { requests: [assigned] });
    api.set("POST /api/staff/requests/req_w/status", { request: {} });
    api.set("POST /api/staff/requests/req_a/status", { request: {} });
    renderAt("/staff?tab=working");
    await screen.findByRole("link", { name: "Chair broken" });
    return userEvent.setup();
  }

  it("Resolve asks first; Cancel sends nothing; a note is sent when given and left out when blank", async () => {
    const user = await openWorking();
    await user.click(screen.getByRole("button", { name: "Resolve Chair broken" }));
    let dialog = screen.getByRole("dialog", { name: "Resolve this request?" });
    expect(within(dialog).getByText("Chair broken")).toBeTruthy();
    const field = within(dialog).getByRole("textbox", { name: "Note for the reporter (optional)" });
    expect(field.getAttribute("maxlength")).toBe("500");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(statusPosts()).toHaveLength(0);

    await user.click(screen.getByRole("button", { name: "Resolve Chair broken" }));
    dialog = screen.getByRole("dialog", { name: "Resolve this request?" });
    await user.type(within(dialog).getByRole("textbox", { name: "Note for the reporter (optional)" }), "Replaced the HDMI cable");
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(statusPosts()).toHaveLength(1));
    expect(statusPosts()[0]?.body).toEqual({ status: "resolved", note: "Replaced the HDMI cable" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await screen.findByTestId("status-banner")).textContent).toContain('"Chair broken" is now Resolved.');

    await user.click(screen.getByRole("button", { name: "Resolve Lamp out" }));
    await user.click(within(screen.getByRole("dialog", { name: "Resolve this request?" })).getByRole("button", { name: "Resolve" }));
    await waitFor(() => expect(statusPosts()).toHaveLength(2));
    expect(statusPosts()[1]?.body).toEqual({ status: "resolved" });
  });

  it("Start work stays one click", async () => {
    const user = await openWorking();
    await user.click(screen.getByRole("button", { name: "Start work on Lamp out" }));
    await waitFor(() => expect(statusPosts()[0]?.body).toEqual({ status: "in_progress" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("a network failure says to check the connection: on the page for Start work, in the open dialog for Resolve", async () => {
    rejectFetchFor("/status");
    const user = await openWorking();
    await user.click(screen.getByRole("button", { name: "Start work on Lamp out" }));
    expect(await screen.findByText("Could not save. Check your connection and try again.")).toBeTruthy();
    expect(screen.queryByText(/changed meanwhile/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Resolve Chair broken" }));
    const dialog = screen.getByRole("dialog", { name: "Resolve this request?" });
    await user.type(within(dialog).getByRole("textbox", { name: "Note for the reporter (optional)" }), "Tightened the screws");
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    expect(await within(dialog).findByText("Could not save. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Resolve this request?" })).toBeTruthy();
    expect((within(dialog).getByRole("textbox", { name: "Note for the reporter (optional)" }) as HTMLTextAreaElement).value).toBe("Tightened the screws");
  });

  it("a 409 on Resolve says the request changed meanwhile", async () => {
    const user = await openWorking();
    api.set("POST /api/staff/requests/req_w/status", respond(409, { error: "invalid_transition", message: "The request changed meanwhile; reload and try again." }));
    await user.click(screen.getByRole("button", { name: "Resolve Chair broken" }));
    await user.click(within(screen.getByRole("dialog", { name: "Resolve this request?" })).getByRole("button", { name: "Resolve" }));
    const notice = await screen.findByText('"Chair broken" changed meanwhile. The list has been refreshed.');
    expect(screen.queryByRole("dialog")).toBeNull();
    // The Resolve button that opened the dialog may be gone after the refresh.
    expect(document.activeElement).toBe(notice);
  });

  it("a 409 on Start work puts focus on the notice", async () => {
    const user = await openWorking();
    api.set("POST /api/staff/requests/req_a/status", respond(409, { error: "invalid_transition", message: "x" }));
    await user.click(screen.getByRole("button", { name: "Start work on Lamp out" }));
    const notice = await screen.findByText('"Lamp out" changed meanwhile. The list has been refreshed.');
    expect(document.activeElement).toBe(notice);
  });

  it("a review that fails for another reason keeps the dialog open with the connection message", async () => {
    api.set("POST /api/staff/requests/req_s/review", respond(500, { error: "internal", message: "Something went wrong." }));
    renderAt("/staff");
    const user = userEvent.setup();
    await screen.findByRole("link", { name: "Projector dead" });
    await user.click(within(rowOf("Projector dead")).getByRole("button", { name: /^Accept/ }));
    const dialog = screen.getByRole("dialog", { name: "Accept the suggestion?" });
    await user.click(within(dialog).getByRole("button", { name: "Accept" }));
    expect(await within(dialog).findByText("Could not save. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Accept the suggestion?" })).toBeTruthy();
    expect(screen.queryByText(/Already reviewed/)).toBeNull();
  });

  it("a failed Resolve keeps focus in the dialog, on the message, after the loading button dropped it", async () => {
    let fail: (() => void) | null = null;
    const user = await openWorking();
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) =>
      String(input).endsWith("/status") ? new Promise((_, reject) => (fail = () => reject(new TypeError("Failed to fetch")))) : realFetch(input, init),
    );
    await user.click(screen.getByRole("button", { name: "Resolve Chair broken" }));
    const dialog = screen.getByRole("dialog", { name: "Resolve this request?" });
    await user.type(within(dialog).getByRole("textbox", { name: "Note for the reporter (optional)" }), "Tightened the screws");
    await user.click(within(dialog).getByRole("button", { name: "Resolve" }));
    browserFocusFixup();
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    await act(async () => fail?.());
    const message = await within(dialog).findByText("Could not save. Check your connection and try again.");
    expect(document.activeElement).toBe(message);
  });
});


describe("Work at a glance (VIZ-01)", () => {
  const tile = (name: RegExp) => screen.getByRole("link", { name });

  it("shows four tiles after the first load, from the same four GETs as before", async () => {
    api.set("GET /api/staff/requests?status=in_progress", { requests: [{ ...suggested, id: "req_w", title: "Chair broken", status: "in_progress", ageMinutes: 3000, createdAt: "2026-10-06T13:00:00.000Z", updatedAt: "2026-10-08T12:00:00.000Z" }] });
    renderAt("/staff");
    const list = await screen.findByRole("list", { name: "Work at a glance" });
    expect(within(list).getAllByRole("link").map((l) => l.getAttribute("aria-label"))).toEqual([
      "Suggestions to review: 1 request, oldest 1 hour",
      "To categorize by hand: 2 requests, oldest 1 hour",
      "Assigned, not started: 0 requests",
      // The server answered at 15:00 UTC (created 3,000 minutes earlier); work last changed at 12:00.
      "In progress: 1 request, oldest 3 hours in this status",
    ]);
    expect(api.calls.filter((c) => c.method === "GET" && c.url.startsWith("/api/staff/")).map((c) => c.url)).toEqual([
      "/api/staff/requests",
      "/api/staff/requests?status=assigned",
      "/api/staff/requests?status=in_progress",
      "/api/staff/requests?status=resolved",
    ]);
  });

  it("a tile opens its tab with replace and moves focus to that tab's panel", async () => {
    const { router } = renderAt("/staff");
    await screen.findByRole("list", { name: "Work at a glance" });
    const user = userEvent.setup();
    await user.click(tile(/^In progress/));
    await waitFor(() => expect(screen.getByRole("tab", { name: "In progress" }).getAttribute("aria-selected")).toBe("true"));
    expect(router.state.location.search).toBe("?tab=working");
    expect(router.state.historyAction).toBe("REPLACE");
    await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("tabpanel"));
    expect((document.activeElement as HTMLElement).hidden).toBe(false);
    expect(within(document.activeElement as HTMLElement).getByRole("table", { name: "Assigned and in progress" })).toBeTruthy();
    await user.click(tile(/^Suggestions to review/));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Triage queue" }).getAttribute("aria-selected")).toBe("true"));
    expect(router.state.location.search).toBe("");
    await waitFor(() => expect(within(document.activeElement as HTMLElement).getByRole("table", { name: "Triage queue" })).toBeTruthy());
  });

  it("marks queue rows a day old or more with an Over 24 h pill, and not a row aged 22 h", async () => {
    queue = [{ ...suggested, ageMinutes: 1440 }, { ...pending, ageMinutes: 22 * 60 }, { ...unavailable, ageMinutes: 1439 }];
    renderAt("/staff");
    await screen.findByRole("link", { name: "Projector dead" });
    expect(within(rowOf("Projector dead")).getByText("Over 24 h")).toBeTruthy();
    expect(within(rowOf("Odd smell")).queryByText("Over 24 h")).toBeNull();
    expect(within(rowOf("Wobbly table")).queryByText("Over 24 h")).toBeNull();
    expect(tile(/^Suggestions to review/).getAttribute("aria-label")).toBe("Suggestions to review: 1 request, oldest 24 hours, 1 waiting over 24 hours");
  });

  it("hides the tiles while the load error shows, and Try again brings them back", async () => {
    let failures = 1;
    api.set("GET /api/staff/requests", () => (failures-- > 0 ? respond(500, { error: "internal", message: "x" }) : { requests: queue }));
    renderAt("/staff");
    const alert = await screen.findByText("The queue could not be loaded.");
    expect(screen.queryByRole("list", { name: "Work at a glance" })).toBeNull();
    await userEvent.setup().click(within(alert.closest("[role=alert]") as HTMLElement).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Work at a glance" })).toBeTruthy();
  });

  it("a timed refetch that fails hides the tiles instead of showing stale numbers", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderAt("/staff");
    await screen.findByRole("list", { name: "Work at a glance" });
    api.set("GET /api/staff/requests", respond(500, { error: "internal", message: "x" }));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    await screen.findByText("The queue could not be loaded.");
    expect(screen.queryByRole("list", { name: "Work at a glance" })).toBeNull();
  });

  it("a staff event refetch updates the counts", async () => {
    renderAt("/staff");
    await screen.findByRole("list", { name: "Work at a glance" });
    expect(tile(/^Suggestions to review/).getAttribute("aria-label")).toMatch(/^Suggestions to review: 1 request,/);
    const ws = FakeWebSocket.last();
    await act(async () => ws.open());
    queue = [...queue, { ...suggested, id: "req_new", title: "Lights out in Alder" }];
    await act(async () => ws.receive({ type: "staff_event", event: "triage_ready", requestId: "req_new", category: "electrical_av" }));
    await waitFor(() => expect(tile(/^Suggestions to review/).getAttribute("aria-label")).toMatch(/^Suggestions to review: 2 requests,/));
  });
});

describe("Today's bookings timeline on the staff page (VIZ-02)", () => {
  it("opens its own live socket only while the Today tab shows", async () => {
    renderAt("/staff");
    await screen.findByRole("link", { name: "Projector dead" });
    expect(FakeWebSocket.instances).toHaveLength(1);
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Today's bookings" }));
    await screen.findByRole("group", { name: /^Bookings by space/ });
    expect(FakeWebSocket.instances).toHaveLength(2);
    const ws = FakeWebSocket.last();
    await act(async () => ws.open());
    expect(ws.subscriptions()).toEqual(["2026-10-08"]);
    await user.click(screen.getByRole("tab", { name: "Triage queue" }));
    expect(ws.closedByClient).not.toBeNull();
    expect(FakeWebSocket.instances).toHaveLength(2);
  });

  it("flags a space that has an open request from the queue", async () => {
    queue = [{ ...suggested, resourceId: "res_alder", resourceName: "Alder" }];
    renderAt("/staff?tab=today");
    const chart = await screen.findByRole("group", { name: /^Bookings by space/ });
    const link = within(chart).getByRole("link", { name: "1 open request for Alder" });
    expect(link.getAttribute("href")).toBe("/requests/req_s");
  });

  it("a timeline refetch keeps the last render while it loads", async () => {
    let release: (v: unknown) => void = () => {};
    let gets = 0;
    const body = {
      date: "2026-10-08",
      bookings: [{ id: "rsv_1", resourceId: "res_alder", resourceName: "Alder", kind: "room", employeeId: "emp_001", employeeName: "Noah Yamamoto", startMin: 600, endMin: 660, attendees: 4, title: "Planning" }],
    };
    api.set("GET /api/staff/bookings", () => {
      gets += 1;
      return gets === 1 ? body : new Promise((r) => (release = r)).then(() => body);
    });
    renderAt("/staff?tab=today");
    await screen.findByRole("group", { name: /^Bookings by space/ });
    const ws = FakeWebSocket.last();
    await act(async () => ws.open());
    // Someone books Alder at 13:00: the live snapshot has it, the fetch did not.
    await act(async () =>
      ws.receive({ type: "snapshot", date: "2026-10-08", dateVersion: 2, ledgerVersion: 2, busy: { res_alder: [{ startMin: 600, endMin: 660, mine: false }, { startMin: 780, endMin: 840, mine: false }] } }),
    );
    await waitFor(() => expect(gets).toBe(2));
    const busy = document.querySelector("[aria-busy=true]");
    expect(busy).toBeTruthy();
    expect(within(busy as HTMLElement).getByRole("group", { name: /^Bookings by space/ })).toBeTruthy();
    await act(async () => release(null));
    await waitFor(() => expect(document.querySelector("[aria-busy=true]")).toBeNull());
  });
});
