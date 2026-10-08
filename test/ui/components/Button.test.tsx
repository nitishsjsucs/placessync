import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../../../src/client/ui/Button.tsx";
import { expectNoAxeViolations } from "../axe.ts";

describe("Button", () => {
  it("activates with Enter and Space (native button)", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Book</Button>);
    const user = userEvent.setup();
    await user.tab();
    expect(screen.getByRole("button", { name: "Book" })).toHaveProperty("type", "button");
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("is aria-busy and disabled while loading", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Saving
      </Button>,
    );
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    await userEvent.setup().click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("blocks activation when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Cancel booking
      </Button>,
    );
    await userEvent.setup().click(screen.getByRole("button"));
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole("button").getAttribute("aria-busy")).toBeNull();
  });

  it("is axe clean in every variant", async () => {
    const { container } = render(
      <div>
        <Button>Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="ghost" size="sm">
          Ghost
        </Button>
        <Button loading>Loading</Button>
      </div>,
    );
    await expectNoAxeViolations(container);
  });
});
