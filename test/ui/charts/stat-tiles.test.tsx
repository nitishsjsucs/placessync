import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatTiles } from "../../../src/client/charts/StatTiles.tsx";
import type { Split } from "../../../src/client/charts/held-ahead.ts";
import { expectNoAxeViolations } from "../axe.ts";

const SPLIT: Split = {
  held: { from: "2026-09-18", to: "2026-10-15", weekdays: 20 },
  ahead: { from: "2026-10-16", to: "2026-10-30", weekdays: 11 },
  spaces: [],
  kinds: { desk: { kind: "desk", activeSpaces: 14, heldUtilization: 0.334, aheadUtilization: 0.1 }, room: { kind: "room", activeSpaces: 6, heldUtilization: 0.41, aheadUtilization: 0.2 } },
  bookedAhead: 238,
  cancelled: 38,
  allBookings: 817,
};
const texts = () => within(screen.getByRole("list", { name: "Utilization at a glance" })).getAllByRole("listitem").map((li) => li.textContent);

describe("StatTiles (VIZ-07)", () => {
  it("shows held percentages per kind, bookings ahead and the cancelled share", async () => {
    render(<StatTiles split={SPLIT} to="2026-10-30" />);
    expect(texts()).toEqual([
      "Desk time booked, past days33%of the 14 desks bookable now",
      "Room time booked, past days41%of the 6 rooms bookable now",
      "Booked ahead238 bookingsfrom today to Friday, October 30, 2026",
      "Cancelled38 of 8175% of bookings in the range",
    ]);
    await expectNoAxeViolations();
  });

  it("says so when the range has no past days, no days ahead or no bookings", () => {
    render(
      <StatTiles
        split={{ ...SPLIT, held: null, ahead: null, kinds: { desk: { ...SPLIT.kinds.desk, heldUtilization: null }, room: { ...SPLIT.kinds.room, heldUtilization: null } }, cancelled: 0, allBookings: 0 }}
        to="2026-10-30"
      />,
    );
    expect(texts()).toEqual([
      "Desk time booked, past daysNo past days in this range.",
      "Room time booked, past daysNo past days in this range.",
      "Booked aheadNo days ahead in this range.",
      "CancelledNo bookings in this range.",
    ]);
  });
});
