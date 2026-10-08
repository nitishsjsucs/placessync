import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { renderAt } from "../render-app.tsx";

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
});
