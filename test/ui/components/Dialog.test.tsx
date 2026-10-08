import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "../../../src/client/ui/Button.tsx";
import { Dialog } from "../../../src/client/ui/Dialog.tsx";
import { expectNoAxeViolations } from "../axe.ts";

function Harness({ dismissable = true, withInitial = false }: { dismissable?: boolean; withInitial?: boolean }) {
  const [open, setOpen] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Button>Outside</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Confirm booking"
        dismissable={dismissable}
        initialFocus={withInitial ? confirm : undefined}
        actions={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button ref={confirm}>Confirm</Button>
          </>
        }
      >
        <label>
          Note <input />
        </label>
      </Dialog>
    </div>
  );
}

describe("Dialog", () => {
  it("is a labelled modal dialog and moves focus inside", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = screen.getByRole("dialog", { name: "Confirm booking" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("honours initialFocus", async () => {
    render(<Harness withInitial />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open dialog" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirm" }));
  });

  it("traps Tab and Shift+Tab", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const dialog = screen.getByRole("dialog");
    const input = screen.getByRole("textbox", { name: "Note" });
    const confirm = screen.getByRole("button", { name: "Confirm" });
    expect(document.activeElement).toBe(input);
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(input);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);
    for (let i = 0; i < 6; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("closes on Escape and returns focus to the opener", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "Open dialog" });
    await user.click(opener);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("ignores Escape while not dismissable (pending)", async () => {
    render(<Harness dismissable={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await user.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("makes the page behind it inert while open", async () => {
    const { container } = render(<Harness />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open dialog" }));
    expect(container.closest("[inert]") ?? container.parentElement?.closest("[inert]")).not.toBeNull();
    await userEvent.setup().keyboard("{Escape}");
    expect(container.closest("[inert]")).toBeNull();
  });

  it("is axe clean when open", async () => {
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole("button", { name: "Open dialog" }));
    await expectNoAxeViolations(screen.getByRole("dialog"));
  });
});
