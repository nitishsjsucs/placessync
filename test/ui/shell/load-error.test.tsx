import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HEALTH, installFakeApi, me, respond } from "../fake-api.ts";
import { FakeWebSocket } from "../fake-ws.ts";
import { renderAt } from "../render-app.tsx";
import { browserFocusFixup } from "../setup.ts";

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T15:00:00Z"));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LoadError Try again keeps focus somewhere (UX round 2)", () => {
  it("returns focus to Try again when the retry fails, and moves it to the page heading when the retry works", async () => {
    let answer: ((ok: boolean) => void) | null = null;
    installFakeApi({
      "GET /api/health": () =>
        new Promise((resolve) => (answer = (ok) => resolve(ok ? HEALTH : respond(500, { error: "internal", message: "The server did not answer." })))),
      "GET /api/me": me("emp_001", "employee"),
      "GET /api/sites/hq/availability": { date: "2026-10-08", version: 1, ledgerVersion: 1, resources: [] },
    });
    renderAt("/find");
    await waitFor(() => expect(answer).not.toBeNull());
    await act(async () => answer?.(false));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Could not load PlacesSync: The server did not answer.");
    const user = userEvent.setup();

    answer = null;
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    // Disabled while it runs: Chrome moves focus to body.
    browserFocusFixup();
    await waitFor(() => expect(answer).not.toBeNull());
    await act(async () => answer?.(false));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("button", { name: "Try again" })));

    answer = null;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    browserFocusFixup();
    await waitFor(() => expect(answer).not.toBeNull());
    await act(async () => answer?.(true));
    const heading = await screen.findByRole("heading", { level: 1, name: "Find a space" });
    await waitFor(() => expect(document.activeElement).toBe(heading));
  });
});
