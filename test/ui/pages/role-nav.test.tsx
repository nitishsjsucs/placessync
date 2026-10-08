import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { renderAt } from "../render-app.tsx";

afterEach(() => vi.unstubAllGlobals());

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
