import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Button } from "../../../src/client/ui/Button.tsx";
import { DataTable } from "../../../src/client/ui/DataTable.tsx";
import { expectNoAxeViolations } from "../axe.ts";
import { setMediaMatches } from "../setup.ts";

type Row = { id: string; resource: string; time: string };
const columns = [
  { key: "resource", header: "Resource", render: (r: Row) => r.resource },
  { key: "time", header: "Time", render: (r: Row) => r.time },
];
const rows: Row[] = [
  { id: "a", resource: "Desk 2A-01", time: "09:00 to 11:00" },
  { id: "b", resource: "Sequoia", time: "13:00 to 14:00" },
];

describe("DataTable", () => {
  it("renders a captioned semantic table", () => {
    render(<DataTable caption="Upcoming bookings" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const table = screen.getByRole("table", { name: "Upcoming bookings" });
    expect(within(table).getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["Resource", "Time"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });

  it("shows the empty state", () => {
    render(<DataTable caption="Upcoming bookings" columns={columns} rows={[]} rowKey={(r) => r.id} empty="No bookings yet." />);
    expect(screen.getByText("No bookings yet.")).toBeTruthy();
  });

  it("labels every cell for the stacked mobile layout", () => {
    render(<DataTable caption="Upcoming" columns={columns} rows={rows} rowKey={(r) => r.id} rowActions={(r) => <Button size="sm">Cancel {r.resource}</Button>} />);
    const cells = screen.getAllByRole("cell");
    expect(cells.map((c) => c.getAttribute("data-label"))).toEqual(["Resource", "Time", "Actions", "Resource", "Time", "Actions"]);
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("is axe clean with rows and empty", async () => {
    const { container, rerender } = render(<DataTable caption="Upcoming" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    await expectNoAxeViolations(container);
    rerender(<DataTable caption="Upcoming" columns={columns} rows={[]} rowKey={(r) => r.id} />);
    await expectNoAxeViolations(container);
  });
});

describe("DataTable sorting (Tier 2)", () => {
  type S = { id: string; name: string; n: number };
  const data: S[] = [
    { id: "1", name: "Sequoia", n: 8 },
    { id: "2", name: "Cypress", n: 2 },
    { id: "3", name: "Madrone", n: 12 },
  ];
  const cols = [
    { key: "name", header: "Room", render: (r: S) => r.name, sortValue: (r: S) => r.name },
    { key: "n", header: "Seats", render: (r: S) => r.n, sortValue: (r: S) => r.n },
    { key: "plain", header: "Note", render: () => "-" },
  ];
  const firstColumn = () =>
    screen
      .getAllByRole("row")
      .slice(1)
      .map((r) => within(r).getAllByRole("cell")[0]?.textContent);

  it("header buttons toggle aria-sort and the row order", async () => {
    render(<DataTable caption="Rooms" columns={cols} rows={data} rowKey={(r) => r.id} />);
    const [room, seats, note] = screen.getAllByRole("columnheader");
    expect(room?.getAttribute("aria-sort")).toBe("none");
    expect(note?.getAttribute("aria-sort")).toBeNull();
    const user = userEvent.setup();
    await user.click(within(seats as HTMLElement).getByRole("button", { name: /Seats/ }));
    expect(seats?.getAttribute("aria-sort")).toBe("ascending");
    expect(firstColumn()).toEqual(["Cypress", "Sequoia", "Madrone"]);
    await user.click(within(seats as HTMLElement).getByRole("button", { name: /Seats/ }));
    expect(seats?.getAttribute("aria-sort")).toBe("descending");
    expect(firstColumn()).toEqual(["Madrone", "Sequoia", "Cypress"]);
    expect(room?.getAttribute("aria-sort")).toBe("none");
  });

  it("sorts from the keyboard", async () => {
    render(<DataTable caption="Rooms" columns={cols} rows={data} rowKey={(r) => r.id} />);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement?.textContent).toContain("Room");
    await user.keyboard("{Enter}");
    expect(firstColumn()).toEqual(["Cypress", "Madrone", "Sequoia"]);
    await user.keyboard(" ");
    expect(firstColumn()).toEqual(["Sequoia", "Madrone", "Cypress"]);
  });

  it("offers a Sort by select in the stacked layout and stays axe clean", async () => {
    setMediaMatches("(max-width: 639px)", true);
    const { container } = render(<DataTable caption="Rooms" columns={cols} rows={data} rowKey={(r) => r.id} />);
    expect(screen.queryByRole("button")).toBeNull();
    await userEvent.setup().selectOptions(screen.getByRole("combobox", { name: "Sort by" }), "n:descending");
    expect(firstColumn()).toEqual(["Madrone", "Sequoia", "Cypress"]);
    await expectNoAxeViolations(container);
  });
});
