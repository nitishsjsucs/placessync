import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateResources } from "../../../src/shared/synthetic/resources.ts";
import { addDays } from "../../../src/shared/time.ts";
import { HEALTH, installFakeApi, me } from "../fake-api.ts";
import { FakeWebSocket } from "../fake-ws.ts";
import { renderAt } from "../render-app.tsx";

const RESOURCES = generateResources();

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T15:00:00Z"));
  installFakeApi({
    "GET /api/health": HEALTH,
    "GET /api/me": me("emp_001", "employee"),
    "GET /api/sites/hq/availability": (c: { url: string }) => ({
      date: new URL(c.url, "http://x").searchParams.get("date"),
      version: 1,
      ledgerVersion: 1,
      resources: RESOURCES.map((resource) => ({ resource, busy: [], freeWindows: [], fitsWindow: true })),
    }),
    "GET /api/resources/res_sequoia/calendar": (c: { url: string }) => {
      const weekStart = new URL(c.url, "http://x").searchParams.get("weekStart") ?? "";
      return { resource: RESOURCES.find((r) => r.id === "res_sequoia"), days: Array.from({ length: 7 }, (_, i) => ({ date: addDays(weekStart, i), busy: [] })) };
    },
    "GET /api/reservations": { reservations: [], resources: [] },
    "GET /api/sites/hq/resources": { resources: RESOURCES },
    "GET /api/requests": { requests: [] },
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const skipLinks = () => screen.getAllByRole("link", { name: /^Skip to/ }).map((a) => [a.textContent, a.getAttribute("href")]);

describe("AppShell keyboard paths (UX-14)", () => {
  it("offers Skip to availability on Find a space, pointing at the slot area before the grid", async () => {
    renderAt("/find");
    await screen.findByRole("grid", { name: /^Availability on/ });
    expect(skipLinks()).toEqual([
      ["Skip to main content", "#main"],
      ["Skip to availability", "#slots"],
    ]);
    const target = document.getElementById("slots") as HTMLElement;
    expect(target.tabIndex).toBe(-1);
    // The next Tab stop after the target is the grid's roving cell.
    target.focus();
    await userEvent.setup().tab();
    expect((document.activeElement as HTMLElement).getAttribute("role")).toBe("gridcell");
  });

  it("offers Skip to week grid on a resource calendar, and no grid skip link elsewhere", async () => {
    const { router } = renderAt("/resources/res_sequoia");
    await screen.findByRole("heading", { level: 1, name: "Sequoia" });
    expect(skipLinks()).toEqual([
      ["Skip to main content", "#main"],
      ["Skip to week grid", "#slots"],
    ]);
    expect(within(document.getElementById("slots") as HTMLElement).getByRole("grid")).toBeTruthy();
    await router.navigate("/bookings");
    await screen.findByRole("heading", { level: 1, name: "My bookings" });
    expect(skipLinks()).toEqual([["Skip to main content", "#main"]]);
  });

  it("moves focus to the new page's h1 after Enter on a main-nav link", async () => {
    renderAt("/find");
    await screen.findByRole("heading", { level: 1, name: "Find a space" });
    const link = within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "My bookings" });
    link.focus();
    await userEvent.setup().keyboard("{Enter}");
    const heading = await screen.findByRole("heading", { level: 1, name: "My bookings" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });

  it("does not move focus on first load or when a Find a space filter changes the search", async () => {
    const { router } = renderAt("/find");
    await screen.findByRole("grid", { name: /^Availability on/ });
    expect(document.activeElement).toBe(document.body);
    const floor = screen.getByRole("combobox", { name: "Floor" });
    await userEvent.setup().selectOptions(floor, "3");
    await waitFor(() => expect(router.state.location.search).toBe("?floor=3"));
    expect(document.activeElement).toBe(floor);
  });

  it("a redirect on first load (an employee sent away from /staff) does not take focus", async () => {
    const { router } = renderAt("/staff");
    await waitFor(() => expect(router.state.location.pathname).toBe("/find"));
    await screen.findByRole("heading", { level: 1, name: "Find a space" });
    expect(document.activeElement).toBe(document.body);
  });
});
