import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { SlotGrid, type SlotRow, type SlotSelection } from "../../../src/client/ui/SlotGrid.tsx";
import { expectNoAxeViolations } from "../axe.ts";
import { setMediaMatches } from "../setup.ts";

const ROWS: SlotRow[] = [
  { id: "res_2a01", label: "Desk 2A-01", busy: [{ startMin: 600, endMin: 660 }] },
  { id: "res_2a02", label: "Desk 2A-02", busy: [{ startMin: 420, endMin: 480, mine: true }] },
];

function Harness({ rows = ROWS, onCommit }: { rows?: SlotRow[]; onCommit?: (s: SlotSelection | null) => void }) {
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  return (
    <div>
      <SlotGrid
        label="Availability"
        rows={rows}
        openMin={420}
        closeMin={720}
        selection={selection}
        onSelect={(s) => {
          setSelection(s);
          onCommit?.(s);
        }}
      />
      <output data-testid="sel">{selection ? `${selection.rowId} ${selection.startMin}-${selection.endMin}` : "none"}</output>
    </div>
  );
}

const sel = () => screen.getByTestId("sel").textContent;
const focusedCell = () => {
  const el = document.activeElement as HTMLElement;
  return `${el.dataset.row} ${el.dataset.start}`;
};

describe("SlotGrid", () => {
  it("moves with arrow keys through a single tab stop", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.tab();
    expect(focusedCell()).toBe("res_2a01 420");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(focusedCell()).toBe("res_2a01 480");
    await user.keyboard("{ArrowDown}");
    expect(focusedCell()).toBe("res_2a02 480");
    await user.keyboard("{End}");
    expect(focusedCell()).toBe("res_2a02 690");
    await user.keyboard("{Home}{ArrowUp}");
    expect(focusedCell()).toBe("res_2a01 420");
    expect(screen.getAllByRole("gridcell").filter((c) => c.tabIndex === 0)).toHaveLength(1);
  });

  it("Shift+Arrow extends a range within a row and Enter commits onSelect(range)", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{ArrowRight}{Shift>}{ArrowRight}{ArrowRight}{/Shift}");
    expect(sel()).toBe("none");
    await user.keyboard("{Enter}");
    expect(sel()).toBe("res_2a01 450-540");
  });

  it("Shift+Arrow never extends across a busy cell or into another row", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{End}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}{ArrowLeft}");
    expect(focusedCell()).toBe("res_2a01 510");
    await user.keyboard("{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}{Enter}");
    // 600 is busy: the range stops at 570 to 600.
    expect(sel()).toBe("res_2a01 510-600");
    await user.keyboard("{Shift>}{ArrowDown}{/Shift}");
    expect(focusedCell()).toBe("res_2a01 570");
  });

  it("Escape clears the selection", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(sel()).toBe("res_2a01 420-450");
    await user.keyboard("{Escape}");
    expect(sel()).toBe("none");
  });

  it("busy cells are aria-disabled and not selectable", async () => {
    render(<Harness />);
    const busy = screen.getByRole("gridcell", { name: "Desk 2A-01, 10:00 to 10:30, booked" });
    expect(busy.getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByRole("gridcell", { name: "Desk 2A-02, 07:00 to 07:30, your booking" }).getAttribute("aria-disabled")).toBe("true");
    const user = userEvent.setup();
    await user.click(busy);
    expect(sel()).toBe("none");
    await user.keyboard("{Enter}");
    expect(sel()).toBe("none");
  });

  it("clears the selection and announces politely when a live update makes it busy", async () => {
    const { rerender } = render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("gridcell", { name: "Desk 2A-01, 08:00 to 08:30, available" }));
    expect(sel()).toBe("res_2a01 480-510");
    const updated: SlotRow[] = [{ ...ROWS[0]!, busy: [...ROWS[0]!.busy, { startMin: 480, endMin: 540 }] }, ROWS[1]!];
    await act(async () => rerender(<Harness rows={updated} />));
    expect(sel()).toBe("none");
    const live = screen.getByTestId("slotgrid-live");
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toContain("08:00 to 08:30 on Desk 2A-01 was just booked");
  });

  it("switches to a single-resource chip list under 640 px (matchMedia stub)", async () => {
    setMediaMatches("(max-width: 639px)", true);
    render(<Harness />);
    expect(screen.queryByRole("grid")).toBeNull();
    const compact = screen.getByTestId("slotgrid-compact");
    expect(within(compact).getByRole("combobox", { name: "Resource" })).toBeTruthy();
    const chips = within(compact).getAllByRole("button");
    expect(chips).toHaveLength(10);
    expect((within(compact).getByRole("button", { name: "10:00 to 10:30, booked" }) as HTMLButtonElement).disabled).toBe(true);
    const user = userEvent.setup();
    await user.click(within(compact).getByRole("button", { name: "08:00 to 08:30" }));
    await user.click(within(compact).getByRole("button", { name: "09:00 to 09:30" }));
    expect(sel()).toBe("res_2a01 480-570");
    await user.selectOptions(within(compact).getByRole("combobox"), "res_2a02");
    expect(within(compact).getByRole("button", { name: "07:00 to 07:30, your booking" })).toBeTruthy();
  });

  it("switches back to the grid when the viewport widens", async () => {
    setMediaMatches("(max-width: 639px)", true);
    render(<Harness />);
    expect(screen.queryByRole("grid")).toBeNull();
    await act(async () => setMediaMatches("(max-width: 639px)", false));
    expect(screen.getByRole("grid")).toBeTruthy();
  });

  it("is axe clean in grid and compact modes", async () => {
    const { container, unmount } = render(<Harness />);
    await expectNoAxeViolations(container);
    unmount();
    setMediaMatches("(max-width: 639px)", true);
    const compact = render(<Harness />);
    await expectNoAxeViolations(compact.container);
  });
});
