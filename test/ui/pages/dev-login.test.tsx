import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { safeNext } from "../../../src/client/pages/DevLoginPage.tsx";
import { HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { renderAt } from "../render-app.tsx";
import { browserFocusFixup } from "../setup.ts";

afterEach(() => vi.unstubAllGlobals());

describe("dev login page", () => {
  it("signs in as a picked employee and returns to the requested page", async () => {
    let signedIn = false;
    const api = installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": () => (signedIn ? me("emp_093", "facilities_staff", "Sam Lee") : respond(401, { error: "unauthenticated", message: "x" })),
      "GET /api/dev/users": {
        users: [
          { id: "emp_001", displayName: "Noah Yamamoto", role: "employee", department: "Operations" },
          { id: "emp_093", displayName: "Sam Lee", role: "facilities_staff", department: "Facilities" },
        ],
      },
      "POST /api/dev/login": () => {
        signedIn = true;
        return { token: "t", expiresAt: "2026-10-08T23:00:00.000Z" };
      },
    });
    const { router } = renderAt("/login?next=%2Fstaff");
    const user = userEvent.setup();
    const combo = await screen.findByRole("combobox", { name: "Employee" });
    await user.click(combo);
    await user.type(combo, "sam");
    await user.keyboard("{Enter}");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/staff"));
    expect(api.calls.find((c) => c.method === "POST" && c.url === "/api/dev/login")?.body).toEqual({ employeeId: "emp_093" });
    expect(await screen.findByText(/Sam Lee/)).toBeTruthy();
  });

  it("asks for a choice before submitting", async () => {
    installFakeApi({ "GET /api/health": HEALTH, "GET /api/me": respond(401, { error: "unauthenticated", message: "x" }), "GET /api/dev/users": { users: [] } });
    renderAt("/login");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Choose who to sign in as.")).toBeTruthy();
  });

  it("on a database with no synthetic employees, says to seed and recovers through Check again", async () => {
    let seeded = false;
    const api = installFakeApi({
      "GET /api/health": () => ({ ...HEALTH, seeded, siteToday: seeded ? HEALTH.siteToday : null, siteRules: seeded ? HEALTH.siteRules : null }),
      "GET /api/me": respond(401, { error: "unauthenticated", message: "x" }),
      "GET /api/dev/users": () =>
        seeded ? { users: [{ id: "emp_100", displayName: "Chloe Mensah", role: "facilities_admin", department: "Facilities" }] } : { users: [] },
    });
    renderAt("/login");
    const alert = await screen.findByText("No synthetic employees yet. Run npm run seed:local in another terminal, then press Check again.");
    expect(alert.closest("[role=alert]")).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Quick picks" })).toBeNull();
    seeded = true;
    const before = api.calls.length;
    await userEvent.setup().click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByRole("button", { name: "Facilities admin: Chloe Mensah" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Quick picks" })).toBeTruthy();
    expect(screen.queryByText(/No synthetic employees yet/)).toBeNull();
    // Check again went away with the notice; focus is on the Employee field.
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "Employee" })));
    // Both the users list and health were fetched again, without a page reload.
    const again = api.calls.slice(before).map((c) => c.url);
    expect(again).toEqual(expect.arrayContaining(["/api/dev/users", "/api/health"]));
  });

  it("Check again keeps focus on itself while the problem remains", async () => {
    let answer: (() => void) | null = null;
    installFakeApi({
      "GET /api/health": () => new Promise((resolve) => (answer = () => resolve({ ...HEALTH, seeded: false, siteToday: null, siteRules: null }))),
      "GET /api/me": respond(401, { error: "unauthenticated", message: "x" }),
      "GET /api/dev/users": { users: [] },
    });
    renderAt("/login");
    await waitFor(() => expect(answer).not.toBeNull());
    await act(async () => answer?.());
    const check = await screen.findByRole("button", { name: "Check again" });
    answer = null;
    await userEvent.setup().click(check);
    browserFocusFixup();
    await waitFor(() => expect(answer).not.toBeNull());
    await act(async () => answer?.());
    expect(screen.getByText(/No synthetic employees yet/)).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Check again" })));
  });

  it("on a database without tables, shows the migrate instruction from health", async () => {
    installFakeApi({
      "GET /api/health": respond(503, { error: "schema_missing", message: "The local database has no tables yet. Run npm run db:migrate:local, then reload." }),
      "GET /api/dev/users": respond(500, { error: "internal", message: "x" }),
    });
    renderAt("/login");
    expect(await screen.findByText("Could not load PlacesSync: The local database has no tables yet. Run npm run db:migrate:local, then reload.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
    expect(screen.queryByText(/Seed the database first/)).toBeNull();
  });

  it("when already signed in, offers Continue to a same-origin next path only", async () => {
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/dev/users": { users: [{ id: "emp_001", displayName: "Test Person", role: "employee", department: "Engineering" }] },
    });
    const first = renderAt("/login?next=%2Fbookings");
    expect(await screen.findByText("Signed in as Test Person.")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Continue as Test Person" }).getAttribute("href")).toBe("/bookings");
    first.unmount();

    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "/\t/evil.example/phish", "/\n/evil.example", "/\r/evil.example", "/find\\..\\/evil.example"]) {
      const view = renderAt(`/login?next=${encodeURIComponent(bad)}`);
      expect((await screen.findByRole("link", { name: "Continue as Test Person" })).getAttribute("href")).toBe("/find");
      view.unmount();
    }
  });

  it("safeNext keeps same-origin paths with their search and refuses anything a browser could read as another host", () => {
    for (const good of ["/find?kind=room&q=a%20b", "/requests/req_1", "/staff?tab=working"]) expect(safeNext(good)).toBe(good);
    for (const bad of [null, "", "find", "//evil.example", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/x\u0000y", "javascript:alert(1)"]) expect(safeNext(bad)).toBe("/find");
  });

  it("after a sign-in expires mid-session, says so, and signing in returns to the same search with focus on its heading", async () => {
    let expired = false;
    const unauthenticated = respond(401, { error: "unauthenticated", message: "Sign in again." });
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": () => (expired ? unauthenticated : me("emp_001", "employee", "Test Person")),
      "GET /api/dev/users": { users: [{ id: "emp_001", displayName: "Test Person", role: "employee", department: "Engineering" }] },
      "GET /api/sites/hq/availability": () => (expired ? unauthenticated : { date: "2026-10-08", version: 1, ledgerVersion: 1, resources: [] }),
      "POST /api/dev/login": () => {
        expired = false;
        return { token: "t", expiresAt: "2026-10-08T23:00:00.000Z" };
      },
    });
    vi.stubGlobal("WebSocket", class { addEventListener() {} close() {} });
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T15:00:00Z"));
    const { router } = renderAt("/find?kind=room");
    await screen.findByRole("heading", { level: 1, name: "Find a space" });
    expired = true;
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Desks" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in (local development)" })).toBeTruthy();
    expect(new URLSearchParams(router.state.location.search).get("next")).toBe("/find?kind=desk");
    expect(screen.getByRole("alert").textContent).toBe("Your sign-in expired, so your last action was not saved. Sign in again to continue where you were.");
    await user.click(await screen.findByRole("button", { name: "Employee: Test Person" }));
    const heading = await screen.findByRole("heading", { level: 1, name: "Find a space" });
    expect(router.state.location.search).toBe("?kind=desk");
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("a first visit without a sign-in shows no expired notice", async () => {
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": respond(401, { error: "unauthenticated", message: "x" }),
      "GET /api/dev/users": { users: [{ id: "emp_001", displayName: "Test Person", role: "employee", department: "Engineering" }] },
    });
    const { router } = renderAt("/bookings");
    await screen.findByRole("heading", { level: 1, name: "Sign in (local development)" });
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent("/bookings")}`);
    expect(screen.queryByText(/Your sign-in expired/)).toBeNull();
  });

  it("after Sign in, ignores a next parameter that points at another origin", async () => {
    let signedIn = false;
    installFakeApi({
      "GET /api/health": HEALTH,
      "GET /api/me": () => (signedIn ? me("emp_001", "employee") : respond(401, { error: "unauthenticated", message: "x" })),
      "GET /api/dev/users": { users: [{ id: "emp_001", displayName: "Test Person", role: "employee", department: "Engineering" }] },
      "GET /api/sites/hq/availability": { date: "2026-10-08", version: 1, ledgerVersion: 1, resources: [] },
      "POST /api/dev/login": () => {
        signedIn = true;
        return { token: "t", expiresAt: "2026-10-08T23:00:00.000Z" };
      },
    });
    vi.stubGlobal("WebSocket", class { addEventListener() {} close() {} });
    const { router } = renderAt("/login?next=%2F%2Fevil.example");
    await userEvent.setup().click(await screen.findByRole("button", { name: "Employee: Test Person" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/find"));
  });
});
