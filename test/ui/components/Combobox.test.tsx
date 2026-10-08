import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Combobox, type ComboboxOption } from "../../../src/client/ui/Combobox.tsx";
import { expectNoAxeViolations } from "../axe.ts";

const OPTIONS: ComboboxOption[] = [
  { value: "res_redwood", label: "Redwood", hint: "Room, 4 seats" },
  { value: "res_sequoia", label: "Sequoia", hint: "Room, 8 seats" },
  { value: "res_cypress", label: "Cypress", hint: "Phone booth" },
  { value: "res_juniper", label: "Juniper", hint: "Room, 6 seats" },
];

function Harness({ initial = null }: { initial?: string | null }) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <div>
      <Combobox label="Resource" options={OPTIONS} value={value} onChange={setValue} hint="Optional" />
      <output data-testid="value">{value ?? "none"}</output>
      <button type="button">Next field</button>
    </div>
  );
}

const input = () => screen.getByRole("combobox", { name: "Resource" });
const activeLabel = () => {
  const id = input().getAttribute("aria-activedescendant");
  return id ? document.getElementById(id)?.textContent : null;
};

describe("Combobox", () => {
  it("ArrowDown opens and moves aria-activedescendant; ArrowUp, Home, End", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(input());
    await user.keyboard("{Escape}");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    await user.keyboard("{ArrowDown}");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(activeLabel()).toContain("Redwood");
    await user.keyboard("{ArrowDown}");
    expect(activeLabel()).toContain("Sequoia");
    await user.keyboard("{ArrowUp}");
    expect(activeLabel()).toContain("Redwood");
    await user.keyboard("{End}");
    expect(activeLabel()).toContain("Juniper");
    await user.keyboard("{Home}");
    expect(activeLabel()).toContain("Redwood");
  });

  it("Enter selects the active option and closes", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(input());
    await user.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByTestId("value").textContent).toBe("res_sequoia");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect((input() as HTMLInputElement).value).toBe("Sequoia");
  });

  it("Escape closes, then a second Escape clears", async () => {
    render(<Harness initial="res_cypress" />);
    const user = userEvent.setup();
    await user.click(input());
    expect(input().getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("value").textContent).toBe("res_cypress");
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("value").textContent).toBe("none");
    expect((input() as HTMLInputElement).value).toBe("");
  });

  it("Tab closes without selecting", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(input());
    await user.keyboard("{ArrowDown}{ArrowDown}");
    await user.tab();
    expect(screen.getByTestId("value").textContent).toBe("none");
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Next field" }));
  });

  it("typing filters the options", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(input());
    await user.type(input(), "jun");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["JuniperRoom, 6 seats"]);
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("value").textContent).toBe("res_juniper");
    await user.clear(input());
    await user.type(input(), "zzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matches")).toBeTruthy();
  });

  it("is axe clean open and closed", async () => {
    const { container } = render(<Harness />);
    await expectNoAxeViolations(container);
    const user = userEvent.setup();
    await user.click(input());
    await user.keyboard("{ArrowDown}");
    await expectNoAxeViolations(container);
  });
});
