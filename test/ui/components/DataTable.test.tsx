import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../../../src/client/ui/Button.tsx";
import { DataTable } from "../../../src/client/ui/DataTable.tsx";
import { expectNoAxeViolations } from "../axe.ts";

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
