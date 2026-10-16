import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { renderAt, renderAtEntries } from "../render-app.tsx";

const base = {
  siteId: "hq",
  reporterId: "emp_001",
  reporterName: "Test Person",
  resourceId: null,
  resourceName: null,
  locationNote: "",
  description: "The projector in Sequoia shows no signal from the HDMI cable.",
  triageAttempts: 1,
  reviewedBy: null,
  reviewedAt: null,
  createdAt: "2026-10-08T15:00:00.000Z",
  updatedAt: "2026-10-08T15:00:00.000Z",
  finalCategory: null,
  reviewDecision: null,
};
const submitted = { ...base, id: "req_p", title: "Projector dead", status: "submitted", triageState: "pending" };
const awaiting = { ...submitted, status: "awaiting_review", triageState: "suggested" };
const suggestion = { category: "electrical_av", confidence: 0.8, rationale: "Projector is AV.", provider: "stub", model: "keyword-v1", attempts: 1, latencyMs: 5, createdAt: "x" };
const events = [{ id: 1, type: "submitted", actorId: "emp_001", data: {}, at: "2026-10-08T15:00:00.000Z" }];
const detailGets = (api: { calls: { method: string; url: string }[] }) => api.calls.filter((c) => c.method === "GET" && c.url === "/api/requests/req_p");

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Request detail cancel (UX-07)", () => {
  it("asks first: Keep request sends nothing, Cancel request sends one POST and shows the result", async () => {
    let request: Record<string, unknown> = { ...awaiting };
    const api = installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/requests/req_p": () => ({ request, suggestion, events }),
      "POST /api/requests/req_p/cancel": () => {
        request = { ...request, status: "cancelled" };
        return { request };
      },
    });
    renderAt("/requests/req_p");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel this request" }));
    let dialog = screen.getByRole("dialog", { name: "Cancel this request?" });
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "Keep request" }));
    await user.click(within(dialog).getByRole("button", { name: "Keep request" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(api.calls.some((c) => c.method === "POST")).toBe(false);

    await user.click(screen.getByRole("button", { name: "Cancel this request" }));
    dialog = screen.getByRole("dialog", { name: "Cancel this request?" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel request" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.calls.filter((c) => c.method === "POST")).toHaveLength(1);
    const banner = await screen.findByTestId("status-banner");
    expect(banner.textContent).toContain("Request cancelled.");
    expect(document.activeElement).toBe(banner);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel this request" })).toBeNull());
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });

  it("a refused cancel keeps the request on screen and shows the server's reason under the button", async () => {
    let request: Record<string, unknown> = { ...awaiting };
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/requests/req_p": () => ({ request, suggestion, events }),
      "POST /api/requests/req_p/cancel": () => {
        // Staff picked it up a moment earlier.
        request = { ...request, status: "assigned", finalCategory: "electrical_av" };
        return respond(409, { error: "not_cancellable", message: "Only a request that nobody has picked up can be cancelled." });
      },
    });
    renderAt("/requests/req_p");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel this request" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel request" }));
    const reason = await screen.findByText("Only a request that nobody has picked up can be cancelled.");
    expect(reason.getAttribute("role")).toBe("alert");
    expect(document.activeElement).toBe(reason);
    expect(screen.getByRole("heading", { level: 1, name: "Projector dead" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Request timeline" })).toBeTruthy();
    expect(screen.getByText(submitted.description)).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("button", { name: "Cancel this request" })).toBeNull());
    expect(screen.getByText("Assigned")).toBeTruthy();
  });

  it("a network failure says to check the connection", async () => {
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/requests/req_p": { request: awaiting, suggestion, events },
    });
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => (String(input).endsWith("/cancel") ? Promise.reject(new TypeError("Failed to fetch")) : realFetch(input, init)));
    renderAt("/requests/req_p");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Cancel this request" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel request" }));
    expect(await screen.findByText("Could not cancel. Check your connection and try again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel this request" })).toBeTruthy();
  });
});

describe("Request detail while classification is pending (UX-07)", () => {
  async function openPending() {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let request: Record<string, unknown> = { ...submitted };
    let suggested: typeof suggestion | null = null;
    const api = installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/requests/req_p": () => ({ request, suggestion: suggested, events }),
    });
    renderAt("/requests/req_p");
    expect(await screen.findByText("Classification pending")).toBeTruthy();
    const triage = () => {
      request = { ...awaiting };
      suggested = suggestion;
    };
    return { api, triage };
  }

  it("checks again every 10 s until the suggestion arrives, then stops", async () => {
    const { api, triage } = await openPending();
    expect(detailGets(api)).toHaveLength(1);
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(detailGets(api)).toHaveLength(2);
    triage();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(await screen.findByText("Electrical and AV (Keyword stub (keyword-v1)), awaiting staff review")).toBeTruthy();
    expect(screen.getByText("Awaiting staff review")).toBeTruthy();
    const after = detailGets(api).length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(detailGets(api)).toHaveLength(after);
    expect(screen.queryByRole("button", { name: "Check again" })).toBeNull();
  });

  it("makes no timed request while the page is hidden, and none after 3 minutes", async () => {
    const { api } = await openPending();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(detailGets(api)).toHaveLength(1);
    visibility.mockReturnValue("visible");
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(detailGets(api)).toHaveLength(2);
    await act(async () => vi.advanceTimersByTimeAsync(10 * 60_000));
    // The first load, then the ticks at 40 s to 170 s (14); nothing from 3 minutes on.
    expect(detailGets(api)).toHaveLength(1 + 14);
    expect(detailGets(api).length).toBeLessThanOrEqual(18);
  });

  it("Check again fetches at once", async () => {
    const { api } = await openPending();
    await userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click(screen.getByRole("button", { name: "Check again" }));
    await waitFor(() => expect(detailGets(api)).toHaveLength(2));
  });
});

describe("Request detail notices and the way back (UX-07, UX-08)", () => {
  function fakes(viewer: ReturnType<typeof me>) {
    installFakeApi({ "GET /api/health": HEALTH, "GET /api/me": viewer, "GET /api/requests/req_p": { request: awaiting, suggestion, events } });
  }

  it("shows the submitted notice once, and drops it from history so a reload does not show it", async () => {
    fakes(me("emp_001", "employee"));
    const { router, unmount } = renderAtEntries([{ pathname: "/requests/req_p", state: { created: true, triage: "started" } }]);
    expect(await screen.findByText(/Your request was submitted/)).toBeTruthy();
    await waitFor(() => expect(router.state.location.state).toBeNull());
    expect(screen.getByText(/Your request was submitted/)).toBeTruthy();
    unmount();
    // A reload renders the same history entry again, now without the state.
    renderAtEntries([{ pathname: router.state.location.pathname, state: router.state.location.state }]);
    await screen.findByRole("heading", { level: 1, name: "Projector dead" });
    expect(screen.queryByText(/Your request was submitted/)).toBeNull();
  });

  it.each([
    ["a staff tab it was opened from", me("emp_093", "facilities_staff"), { from: "/staff?tab=working" }, "Back to the staff queue", "/staff?tab=working"],
    ["staff who did not report it", me("emp_093", "facilities_staff"), null, "Back to the staff queue", "/staff"],
    ["the reporter", me("emp_001", "employee"), null, "Back to my requests", "/requests"],
    ["a from state outside the staff pages", me("emp_001", "employee"), { from: "https://evil.example" }, "Back to my requests", "/requests"],
  ])("links back for %s", async (_label, viewer, state, text, href) => {
    fakes(viewer);
    renderAtEntries([{ pathname: "/requests/req_p", state }]);
    expect((await screen.findByRole("link", { name: text })).getAttribute("href")).toBe(href);
  });
});

describe("Request detail timeline (UX-09)", () => {
  it("shows the note staff left when resolving", async () => {
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/requests/req_p": {
        request: { ...awaiting, status: "resolved", finalCategory: "electrical_av" },
        suggestion,
        events: [...events, { id: 2, type: "status_changed", actorId: "emp_093", data: { from: "in_progress", to: "resolved", note: "Replaced the HDMI cable" }, at: "2026-10-08T17:00:00.000Z" }],
      },
    });
    renderAt("/requests/req_p");
    expect(await screen.findByText("Status changed to Resolved: Replaced the HDMI cable")).toBeTruthy();
  });
});

