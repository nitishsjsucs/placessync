import { describe, expect, it } from "vitest";
import * as kit from "../../src/client/ui/index.ts";

const EIGHT = ["Button", "TextField", "Combobox", "DateGrid", "SlotGrid", "Dialog", "Tabs", "DataTable"];

describe("UI kit (SPEC 14.2)", () => {
  it("exports exactly the eight components", () => {
    expect(Object.keys(kit).sort()).toEqual([...EIGHT].sort());
    for (const name of EIGHT) expect(typeof (kit as Record<string, unknown>)[name]).toBe("function");
  });

  it("has a test file for each component", () => {
    // Vite lists the files without importing them.
    const files = Object.keys(import.meta.glob("./components/*.test.tsx")).map((f) => f.replace("./components/", "").replace(".test.tsx", ""));
    expect(files.sort()).toEqual([...EIGHT].sort());
  });
});
