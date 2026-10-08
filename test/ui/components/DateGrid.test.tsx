import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { DateGrid } from "../../../src/client/ui/DateGrid.tsx";
import { isWeekday } from "../../../src/shared/time.ts";
import { expectNoAxeViolations } from "../axe.ts";

function Harness({ initial = "2026-10-14" }: { initial?: string }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <div>
      <DateGrid label="Booking date" value={value} onChange={setValue} today="2026-10-08" isDisabled={(d) => (isWeekday(d) ? null : "Closed on weekends")} />
      <output data-testid="value">{value}</output>
    </div>
  );
}

const focused = () => (document.activeElement as HTMLElement | null)?.dataset.date;

async function focusSelected() {
  const user = userEvent.setup();
  await user.tab();
  await user.tab();
  // Previous month, then the grid's single tab stop.
  return user;
}

describe("DateGrid", () => {
  it("has one tab stop (roving tabindex) on the selected date", async () => {
    render(<Harness />);
    const cells = screen.getAllByRole("gridcell").filter((c) => c.dataset.date);
    expect(cells.filter((c) => c.tabIndex === 0).map((c) => c.dataset.date)).toEqual(["2026-10-14"]);
    const user = await focusSelected();
    await user.tab();
    expect(focused()).toBe("2026-10-14");
  });

  it("arrows move by day and week", async () => {
    render(<Harness />);
    const user = await focusSelected();
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(focused()).toBe("2026-10-15");
    await user.keyboard("{ArrowDown}");
    expect(focused()).toBe("2026-10-22");
    await user.keyboard("{ArrowLeft}{ArrowUp}");
    expect(focused()).toBe("2026-10-14");
  });

  it("PageUp and PageDown move by month; arrows cross month boundaries", async () => {
    render(<Harness initial="2026-10-31" />);
    const user = await focusSelected();
    await user.tab();
    await user.keyboard("{PageDown}");
    expect(focused()).toBe("2026-11-30");
    expect(screen.getByRole("heading", { name: "November 2026" })).toBeTruthy();
    await user.keyboard("{PageUp}{PageUp}");
    expect(focused()).toBe("2026-09-30");
    await user.keyboard("{ArrowRight}");
    expect(focused()).toBe("2026-10-01");
  });

  it("Home and End go to the week bounds (Monday to Sunday)", async () => {
    render(<Harness />);
    const user = await focusSelected();
    await user.tab();
    await user.keyboard("{End}");
    expect(focused()).toBe("2026-10-18");
    await user.keyboard("{Home}");
    expect(focused()).toBe("2026-10-12");
  });

  it("Enter and Space select; disabled dates are focusable but not selectable", async () => {
    render(<Harness />);
    const user = await focusSelected();
    await user.tab();
    await user.keyboard("{ArrowRight}{Enter}");
    expect(screen.getByTestId("value").textContent).toBe("2026-10-15");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(focused()).toBe("2026-10-17");
    const saturday = document.activeElement as HTMLElement;
    expect(saturday.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(saturday.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Closed on weekends");
    await user.keyboard(" ");
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("value").textContent).toBe("2026-10-15");
    await user.keyboard("{ArrowRight}{ArrowRight} ");
    expect(screen.getByTestId("value").textContent).toBe("2026-10-19");
  });

  it("names each cell with the full date and marks today", () => {
    render(<Harness />);
    expect(screen.getByRole("gridcell", { name: "Wednesday, October 14, 2026" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "Thursday, October 8, 2026" }).getAttribute("aria-current")).toBe("date");
  });

  it("is axe clean", async () => {
    const { container } = render(<Harness />);
    await expectNoAxeViolations(container);
  });
});
