import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Freshness, copiedAt } from "../../../src/client/charts/Freshness.tsx";
import type { ProjectionStatusResponse } from "../../../src/shared/api.ts";
import { expectNoAxeViolations } from "../axe.ts";

const TZ = "America/Los_Angeles";
const OK: ProjectionStatusResponse = { ledgerVersion: 12, outboxDepth: 0, backstopHits: 0, lastFlushError: null, flushFailures: 0, d1: { maxLedgerVersion: 12, updatedAt: "2026-10-08T23:05:00.000Z" } };
const show = (status: ProjectionStatusResponse | null, onRefresh = vi.fn()) => ({ ...render(<Freshness status={status} timeZone={TZ} today="2026-10-08" onRefresh={onRefresh} />), onRefresh });

describe("Freshness (VIZ-07)", () => {
  it("in sync: every booking change is in the reports, with the last copy time on the site clock", async () => {
    show(OK);
    expect(screen.getByTestId("freshness").textContent).toBe("Reports include every booking change (last copied 16:05).");
    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    await expectNoAxeViolations();
  });

  it("names the day when the last copy was not today", () => {
    expect(copiedAt("2026-10-06T16:30:00.000Z", TZ, "2026-10-08")).toBe("October 6, 09:30");
  });

  it("before any copy: says nothing has been copied yet", () => {
    show({ ...OK, d1: null });
    expect(screen.getByTestId("freshness").textContent).toBe("No booking has been copied to reports yet.");
  });

  it("lagging: says how many changes are not in the reports yet, and Refresh asks again", async () => {
    const { onRefresh } = show({ ...OK, outboxDepth: 3 });
    expect(screen.getByTestId("freshness").textContent).toContain(
      "3 booking changes had not reached these reports when they loaded. The ledger copies them shortly; in production this can take up to a minute.",
    );
    await userEvent.setup().click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    const { unmount } = render(<Freshness status={{ ...OK, outboxDepth: 1 }} timeZone={TZ} today="2026-10-08" onRefresh={vi.fn()} />);
    expect(screen.getAllByTestId("freshness")[1]?.textContent).toMatch(/^1 booking change had not reached/);
    unmount();
    await expectNoAxeViolations();
  });

  it("a flush error: an icon and words, and that the ledger keeps the bookings", () => {
    show({ ...OK, outboxDepth: 2, lastFlushError: "D1_ERROR" });
    const line = screen.getByText("Copying bookings to reports is failing; bookings themselves are safe in the ledger.");
    expect(line.querySelector("svg[aria-hidden=true]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it("a status that could not be fetched renders nothing", () => {
    const { container } = show(null);
    expect(container.innerHTML).toBe("");
  });
});
