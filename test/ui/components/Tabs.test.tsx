import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Tabs } from "../../../src/client/ui/Tabs.tsx";
import { expectNoAxeViolations } from "../axe.ts";

const TABS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
];

function Harness() {
  const [value, setValue] = useState("upcoming");
  return (
    <Tabs tabs={TABS} value={value} onChange={setValue} label="Bookings">
      {(id) => <p>Panel {id}</p>}
    </Tabs>
  );
}

const selected = () => screen.getAllByRole("tab").find((t) => t.getAttribute("aria-selected") === "true")?.textContent;

describe("Tabs", () => {
  it("links each tab to its panel with aria-controls and aria-selected", () => {
    render(<Harness />);
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false", "false"]);
    for (const t of tabs) expect(document.getElementById(t.getAttribute("aria-controls") ?? "")?.getAttribute("role")).toBe("tabpanel");
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel upcoming");
  });

  it("activates automatically with arrow keys that wrap", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.tab();
    expect(document.activeElement?.textContent).toBe("Upcoming");
    await user.keyboard("{ArrowRight}");
    expect(selected()).toBe("Past");
    expect(screen.getByRole("tabpanel").textContent).toBe("Panel past");
    await user.keyboard("{ArrowRight}{ArrowRight}");
    expect(selected()).toBe("Upcoming");
    await user.keyboard("{ArrowLeft}");
    expect(selected()).toBe("Cancelled");
    expect(document.activeElement?.textContent).toBe("Cancelled");
  });

  it("supports Home and End and a single tab stop", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard("{End}");
    expect(selected()).toBe("Cancelled");
    await user.keyboard("{Home}");
    expect(selected()).toBe("Upcoming");
    expect(screen.getAllByRole("tab").map((t) => t.tabIndex)).toEqual([0, -1, -1]);
  });

  it("is axe clean", async () => {
    const { container } = render(<Harness />);
    await expectNoAxeViolations(container);
  });
});
