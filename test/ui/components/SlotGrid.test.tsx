import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SlotGrid, type SlotRow, type SlotSelection } from "../../../src/client/ui/SlotGrid.tsx";
import { expectNoAxeViolations } from "../axe.ts";
import { setMediaMatches } from "../setup.ts";

const ROWS: SlotRow[] = [
  { id: "res_2a01", label: "Desk 2A-01", busy: [{ startMin: 600, endMin: 660 }] },
  { id: "res_2a02", label: "Desk 2A-02", busy: [{ startMin: 420, endMin: 480, mine: true }] },
];

function Harness({
  rows = ROWS,
  onCommit,
  label = "Availability",
  closeMin = 720,
  minStartFor,
  rowUnavailable,
}: {
  rows?: SlotRow[];
  onCommit?: (s: SlotSelection | null) => void;
  label?: string;
  closeMin?: number;
  minStartFor?: (rowId: string) => number;
  rowUnavailable?: (rowId: string) => string | null;
}) {
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  return (
    <div>
      <SlotGrid
        label={label}
        rows={rows}
        openMin={420}
        closeMin={closeMin}
        selection={selection}
        onSelect={(s) => {
          setSelection(s);
          onCommit?.(s);
        }}
        minStartFor={minStartFor}
        rowUnavailable={rowUnavailable}
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

  it("clears silently when the viewer's own booking arrives live", async () => {
    const { rerender } = render(<Harness />);
    await userEvent.setup().click(screen.getByRole("gridcell", { name: "Desk 2A-01, 08:00 to 08:30, available" }));
    const updated: SlotRow[] = [{ ...ROWS[0]!, busy: [...ROWS[0]!.busy, { startMin: 480, endMin: 510, mine: true }] }, ROWS[1]!];
    await act(async () => rerender(<Harness rows={updated} />));
    expect(sel()).toBe("none");
    expect(screen.getByTestId("slotgrid-live").textContent).toBe("");
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

describe("SlotGrid past and closed cells (UX-01, UX-13)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("draws past cells muted, not hatched like booked ones, and lists them in the legend", async () => {
    render(<Harness minStartFor={() => 495} />);
    const past = screen.getByRole("gridcell", { name: "Desk 2A-01, 08:00 to 08:30, past" });
    expect(past.getAttribute("aria-disabled")).toBe("true");
    expect(past.className).toMatch(/unavailable/);
    expect(past.className).not.toMatch(/busy/);
    const booked = screen.getByRole("gridcell", { name: "Desk 2A-01, 10:00 to 10:30, booked" });
    expect(booked.className).toMatch(/busy/);
    expect(booked.className).not.toMatch(/unavailable/);
    // 08:30 starts after the cut-off of 08:15.
    expect(screen.getByRole("gridcell", { name: "Desk 2A-01, 08:30 to 09:00, available" }).getAttribute("aria-disabled")).toBeNull();
    await userEvent.setup().click(past);
    expect(sel()).toBe("none");
    expect(screen.getByText("Past or closed")).toBeTruthy();
  });

  it("names every cell of an unavailable row with its word, in grid and compact modes", async () => {
    const word = (id: string) => (id === "res_2a02" ? "closed" : null);
    const { unmount } = render(<Harness rowUnavailable={word} />);
    const closed = screen.getByRole("gridcell", { name: "Desk 2A-02, 09:00 to 09:30, closed" });
    expect(closed.getAttribute("aria-disabled")).toBe("true");
    expect(closed.className).toMatch(/unavailable/);
    // The viewer's own booking in that row still says so.
    expect(screen.getByRole("gridcell", { name: "Desk 2A-02, 07:00 to 07:30, your booking" })).toBeTruthy();
    await userEvent.setup().click(closed);
    expect(sel()).toBe("none");
    unmount();

    setMediaMatches("(max-width: 639px)", true);
    render(<Harness rowUnavailable={word} minStartFor={() => 495} />);
    const compact = screen.getByTestId("slotgrid-compact");
    const pastChip = within(compact).getByRole("button", { name: "08:00 to 08:30, past" }) as HTMLButtonElement;
    expect(pastChip.disabled).toBe(true);
    expect(pastChip.className).toMatch(/chipUnavailable/);
    await userEvent.setup().selectOptions(within(compact).getByRole("combobox"), "res_2a02");
    const closedChip = within(compact).getByRole("button", { name: "09:00 to 09:30, closed" }) as HTMLButtonElement;
    expect(closedChip.disabled).toBe(true);
    expect(closedChip.className).toMatch(/chipUnavailable/);
  });

  it("scrolls the first selectable column into view beside the row header, once per date", async () => {
    // jsdom has no layout: 120 px row header, 44 px columns, a 400 px wide scroller.
    vi.spyOn(HTMLElement.prototype, "offsetLeft", "get").mockImplementation(function (this: HTMLElement) {
      const start = this.dataset.start;
      return start === undefined ? 0 : 120 + ((Number(start) - 420) / 30) * 44;
    });
    vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.tagName === "TH" && this.dataset.start === undefined ? 120 : 44;
    });
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (this: HTMLElement) {
      return this.dataset.testid === "slotgrid-scroller" ? 400 : 0;
    });
    // 16:10 on a 07:00 to 19:00 day: the first selectable column is 16:30 (index 19).
    const { rerender } = render(<Harness closeMin={1140} minStartFor={() => 970} label="Availability on Thursday" />);
    const scroller = screen.getByTestId("slotgrid-scroller");
    expect(scroller.scrollLeft).toBe(19 * 44);
    // A live update or a manual scroll is left alone...
    scroller.scrollLeft = 0;
    await act(async () => rerender(<Harness closeMin={1140} minStartFor={() => 970} label="Availability on Thursday" rows={[{ ...ROWS[0]!, busy: [] }, ROWS[1]!]} />));
    expect(scroller.scrollLeft).toBe(0);
    // ...and a new date with an open morning needs no scroll.
    await act(async () => rerender(<Harness closeMin={1140} minStartFor={() => -1} label="Availability on Friday" />));
    expect(scroller.scrollLeft).toBe(0);
  });
});
