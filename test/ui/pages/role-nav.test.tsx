import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { generateResources } from "../../../src/shared/synthetic/resources.ts";
import { HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { FakeWebSocket } from "../fake-ws.ts";
import { renderAt } from "../render-app.tsx";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const navLinks = async () => {
  const nav = await screen.findByRole("navigation", { name: "Main" });
  return within(nav)
    .getAllByRole("link")
    .map((a) => a.textContent);
};

describe("role-based navigation (SPEC 14.1)", () => {
  it("an employee sees no Staff or Admin links and is redirected away from both routes", async () => {
    installFakeApi({ "GET /api/health": HEALTH, "GET /api/me": me("emp_001", "employee") });
    const { router } = renderAt("/staff");
    expect(await navLinks()).toEqual(["Find a space", "My bookings", "Report issue", "My requests"]);
    await waitFor(() => expect(router.state.location.pathname).toBe("/find"));
    await router.navigate("/admin");
    await waitFor(() => expect(router.state.location.pathname).toBe("/find"));
  });

  it("facilities staff see Staff but not Admin, and are redirected from /admin", async () => {
    installFakeApi({ "GET /api/health": HEALTH, "GET /api/me": me("emp_093", "facilities_staff") });
    const { router } = renderAt("/staff");
    expect(await navLinks()).toEqual(["Find a space", "My bookings", "Report issue", "My requests", "Staff"]);
    expect(await screen.findByRole("heading", { level: 1, name: "Facilities staff" })).toBeTruthy();
    await router.navigate("/admin");
    await waitFor(() => expect(router.state.location.pathname).toBe("/find"));
  });

  it("facilities admins see Staff and Admin", async () => {
    installFakeApi({ "GET /api/health": HEALTH, "GET /api/me": me("emp_100", "facilities_admin") });
    renderAt("/admin");
    expect(await navLinks()).toEqual(["Find a space", "My bookings", "Report issue", "My requests", "Staff", "Admin"]);
    expect(await screen.findByRole("heading", { level: 1, name: "Facilities admin" })).toBeTruthy();
  });

  it("sends an anonymous visitor to the dev sign-in page", async () => {
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": respond(401, { error: "unauthenticated", message: "Sign in" }),
      "GET /api/dev/users": { users: [{ id: "emp_100", displayName: "Chloe Mensah", role: "facilities_admin", department: "Facilities" }] },
    });
    const { router } = renderAt("/bookings");
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(router.state.location.search).toBe("?next=%2Fbookings");
    expect(await screen.findByRole("heading", { name: "Sign in (local development)" })).toBeTruthy();
  });

  it("in access mode an anonymous visitor is told to sign in through Access", async () => {
    installFakeApi({ "GET /api/health": { ...HEALTH, authMode: "access" }, "GET /api/me": respond(401, { error: "unauthenticated", message: "x" }) });
    renderAt("/find");
    expect(await screen.findByText("Sign in through Cloudflare Access to use PlacesSync.")).toBeTruthy();
  });
});

describe("session problems (UX-11, UX-16)", () => {
  const ROOMS = generateResources().filter((r) => r.kind === "room");

  // Signed in, then the token expires: the booking POST answers 401 and so does /api/me.
  async function bookWithExpiredToken(health: typeof HEALTH | (typeof HEALTH & { authMode: "access" })) {
    FakeWebSocket.reset();
    vi.stubGlobal("WebSocket", FakeWebSocket);
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T15:00:00Z"));
    let expired = false;
    const api = installFakeApi({
      "GET /api/health": health,
      "GET /api/me": () => (expired ? respond(401, { error: "invalid_token", message: "expired" }) : me("emp_001", "employee")),
      "GET /api/sites/hq/availability": (c: { url: string }) => ({
        date: new URL(c.url, "http://x").searchParams.get("date"),
        version: 1,
        ledgerVersion: 1,
        resources: ROOMS.map((resource) => ({ resource, busy: [], freeWindows: [], fitsWindow: true })),
      }),
      "POST /api/reservations": () => {
        expired = true;
        return respond(401, { error: "invalid_token", message: "The token has expired." });
      },
    });
    const view = renderAt("/find?kind=room");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("gridcell", { name: "Sequoia (8), 09:00 to 09:30, available" }));
    await user.click(screen.getByRole("button", { name: /^Book Sequoia/ }));
    await user.click(screen.getByRole("button", { name: "Confirm booking" }));
    return { ...view, api };
  }

  it("dev mode: a 401 mid-session leads back to sign-in with the current path and query", async () => {
    const { router } = await bookWithExpiredToken(HEALTH);
    await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe("/find?kind=room");
    expect(await screen.findByRole("heading", { name: "Sign in (local development)" })).toBeTruthy();
  });

  it("access mode: a 401 mid-session says the sign-in expired and offers Reload", async () => {
    const { api } = await bookWithExpiredToken({ ...HEALTH, authMode: "access" } as typeof HEALTH);
    expect(await screen.findByText("Your sign-in has expired. Reload to sign in again.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reload" })).toBeTruthy();
    expect(screen.queryByText("Sign in through Cloudflare Access to use PlacesSync.")).toBeNull();
    // The session routes are checked once; they never trigger another check themselves.
    expect(api.calls.filter((c) => c.url === "/api/me").length).toBe(2);
  });

  it("access mode: an identity PlacesSync does not know (403 unknown_user) is told to ask an admin", async () => {
    installFakeApi({ "GET /api/health": { ...HEALTH, authMode: "access" }, "GET /api/me": respond(403, { error: "unknown_user", message: "No employee." }) });
    renderAt("/find");
    expect(await screen.findByText("This account is not set up in PlacesSync. Ask a facilities admin.")).toBeTruthy();
    expect(screen.queryByText("Sign in through Cloudflare Access to use PlacesSync.")).toBeNull();
  });

  it("a failed health check shows the server's message and Try again, which loads the app once it recovers", async () => {
    let migrated = false;
    const api = installFakeApi({
      "GET /api/health": () =>
        migrated ? HEALTH : respond(503, { error: "schema_missing", message: "The local database has no tables yet. Run npm run db:migrate:local, then reload." }),
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/reservations": { reservations: [], resources: [] },
      "GET /api/sites/hq/resources": { resources: [] },
    });
    renderAt("/bookings");
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not load PlacesSync: The local database has no tables yet. Run npm run db:migrate:local, then reload.");
    const before = api.calls.filter((c) => c.url === "/api/health").length;
    migrated = true;
    await userEvent.setup().click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { level: 1, name: "My bookings" })).toBeTruthy();
    expect(api.calls.filter((c) => c.url === "/api/health").length).toBe(before + 1);
  });
});
