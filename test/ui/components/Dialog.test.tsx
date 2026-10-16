import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState } from "react";
import { describe, expect, it } from "vitest";
import { Button } from "../../../src/client/ui/Button.tsx";
import { Combobox } from "../../../src/client/ui/Combobox.tsx";
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

function FallbackHarness({ disabledInitial = false, withReturn = false }: { disabledInitial?: boolean; withReturn?: boolean }) {
  const [open, setOpen] = useState(false);
  const [openerGone, setOpenerGone] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);
  const back = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <main id="main" tabIndex={-1}>
        <Button onClick={() => setOpen(true)} disabled={openerGone}>
          Open dialog
        </Button>
        <Button ref={back}>Return here</Button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          title="Fallbacks"
          initialFocus={confirm}
          returnFocus={withReturn ? back : undefined}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => {
                  setOpenerGone(true);
                  setOpen(false);
                }}
              >
                Done
              </Button>
              <Button ref={confirm} disabled={disabledInitial}>
                Confirm
              </Button>
            </>
          }
        >
          <p>Body text.</p>
        </Dialog>
      </main>
    </div>
  );
}

function TypingHarness() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const confirm = useRef<HTMLButtonElement>(null);
  const field = useRef<HTMLInputElement>(null);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Typing"
        // The page prefers the field until something is typed, then Confirm.
        initialFocus={text ? confirm : field}
        actions={<Button ref={confirm}>Confirm</Button>}
      >
        <label>
          Note <input ref={field} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      </Dialog>
    </div>
  );
}

function ComboHarness() {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<string | null>(null);
  return (
    <div>
      <Button onClick={() => setOpen(true)}>Open dialog</Button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Pick a category">
        <Combobox
          label="Category"
          options={[
            { value: "a", label: "Alpha" },
            { value: "b", label: "Beta" },
          ]}
          value={value}
          onChange={setValue}
        />
      </Dialog>
    </div>
  );
}

describe("Dialog focus fallbacks and document-level Escape", () => {
  it("falls back to a focusable element when initialFocus is disabled, and Escape still closes it", async () => {
    render(<FallbackHarness disabledInitial />);
    const user = userEvent.setup();
    const opener = screen.getByRole("button", { name: "Open dialog" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Fallbacks" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Done" }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes on Escape wherever focus is, even outside the dialog", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    (document.activeElement as HTMLElement).blur();
    expect(document.activeElement).toBe(document.body);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("an Escape that closes an open Combobox listbox does not close the dialog; the next one does", async () => {
    render(<ComboHarness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const combo = screen.getByRole("combobox", { name: "Category" });
    expect(document.activeElement).toBe(combo);
    await user.keyboard("{ArrowDown}");
    expect(combo.getAttribute("aria-expanded")).toBe("true");
    await user.keyboard("{Escape}");
    expect(combo.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("dialog", { name: "Pick a category" })).toBeTruthy();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("does not move focus when the page changes initialFocus while the dialog is open", async () => {
    render(<TypingHarness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    const field = screen.getByRole("textbox", { name: "Note" });
    expect(document.activeElement).toBe(field);
    await user.keyboard("abc");
    expect(document.activeElement).toBe(field);
    expect((field as HTMLInputElement).value).toBe("abc");
  });

  it("returns focus to returnFocus when the opener was disabled, else to #main, never body", async () => {
    const first = render(<FallbackHarness withReturn />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Return here" }));
    first.unmount();

    render(<FallbackHarness />);
    await user.click(screen.getByRole("button", { name: "Open dialog" }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(document.activeElement).toBe(document.getElementById("main"));
  });
});
