import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { TextField, type TextFieldProps } from "../../../src/client/ui/TextField.tsx";
import { expectNoAxeViolations } from "../axe.ts";

function Controlled(props: Omit<TextFieldProps, "value" | "onChange"> & { initial?: string }) {
  const [value, setValue] = useState(props.initial ?? "");
  return <TextField {...props} value={value} onChange={setValue} />;
}

describe("TextField", () => {
  it("associates the label with the input", () => {
    render(<Controlled label="Title" />);
    expect(screen.getByLabelText("Title").tagName).toBe("INPUT");
  });

  it("links hint and error through aria-describedby and sets aria-invalid", () => {
    render(<Controlled label="Title" hint="5 to 120 characters" error="Title is too short." />);
    const input = screen.getByLabelText("Title");
    const ids = (input.getAttribute("aria-describedby") ?? "").split(" ");
    const texts = ids.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toEqual(["5 to 120 characters", "Title is too short."]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("has no aria-invalid without an error", () => {
    render(<Controlled label="Title" />);
    expect(screen.getByLabelText("Title").getAttribute("aria-invalid")).toBeNull();
  });

  it("counts characters and announces politely at 80% and 100%", async () => {
    render(<Controlled id="t" label="Title" maxLength={10} />);
    const input = screen.getByLabelText("Title");
    const counter = document.getElementById("t-counter");
    expect((input.getAttribute("aria-describedby") ?? "").split(" ")).toContain("t-counter");
    const live = screen.getByTestId("t-announce");
    expect(live.getAttribute("aria-live")).toBe("polite");
    const user = userEvent.setup();
    await user.type(input, "abcdefg");
    expect(counter?.textContent).toBe("7 / 10");
    expect(live.textContent).toBe("");
    await user.type(input, "h");
    expect(live.textContent).toBe("2 characters left");
    await user.type(input, "ij");
    expect(live.textContent).toBe("Character limit of 10 reached");
    await user.type(input, "k");
    expect((input as HTMLInputElement).value).toBe("abcdefghij");
  });

  it("renders a multiline textarea", () => {
    render(<Controlled label="Description" multiline />);
    expect(screen.getByLabelText("Description").tagName).toBe("TEXTAREA");
  });

  it("is axe clean in valid and invalid states", async () => {
    const { container, rerender } = render(<TextField label="Title" value="" onChange={() => {}} hint="Short summary" required />);
    await expectNoAxeViolations(container);
    await act(async () => {
      rerender(<TextField label="Title" value="ab" onChange={() => {}} hint="Short summary" error="Too short" required maxLength={120} />);
    });
    await expectNoAxeViolations(container);
  });
});
