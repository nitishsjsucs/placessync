import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { KeptMatrix, ShareLegend, headline } from "../../../src/client/charts/KeptMatrix.tsx";
import { type KeptCell, matrices, mostChanged, shareBin } from "../../../src/client/charts/kept-matrix.ts";
import { expectNoAxeViolations } from "../axe.ts";

const CELLS: KeptCell[] = [
  { provider: "stub", suggested: "electrical_av", final: "electrical_av", n: 5 },
  { provider: "stub", suggested: "electrical_av", final: "building_systems", n: 1 },
  { provider: "stub", suggested: "furniture_fixtures", final: "building_systems", n: 2 },
  { provider: "stub", suggested: "furniture_fixtures", final: "furniture_fixtures", n: 6 },
  { provider: "workers-ai", suggested: "cleaning_safety", final: "cleaning_safety", n: 3 },
];

describe("kept matrices (VIZ-09)", () => {
  it("builds one matrix per provider, never merged, with rows only for suggested categories that were reviewed", () => {
    const [stub, ai] = matrices(CELLS, ["keyword-fallback", "stub", "workers-ai"]);
    expect(stub?.provider).toBe("stub");
    expect(stub?.rows.map((r) => [r.suggested, r.counts, r.kept, r.total])).toEqual([
      ["electrical_av", [1, 5, 0, 0], 5, 6],
      ["furniture_fixtures", [2, 0, 6, 0], 6, 8],
    ]);
    expect([stub?.reviewed, stub?.kept]).toEqual([14, 11]);
    expect(ai?.rows.map((r) => r.suggested)).toEqual(["cleaning_safety"]);
    // A provider with no reviews gets no matrix.
    expect(matrices(CELLS, ["keyword-fallback", "stub", "workers-ai"])).toHaveLength(2);
  });

  it("bins a cell by its share of the row on the five-step ramp, 0 apart", () => {
    expect([shareBin(0, 8), shareBin(1, 8), shareBin(2, 8), shareBin(3, 8), shareBin(5, 8), shareBin(6, 8), shareBin(8, 8)]).toEqual([0, 1, 2, 2, 4, 4, 5]);
    expect(shareBin(1, 5)).toBe(1);
    expect(shareBin(2, 5)).toBe(2);
  });

  it("names the largest changed pair, breaking ties by category order, or says every suggestion was kept", () => {
    const [stub] = matrices(CELLS);
    expect(mostChanged(stub!)).toEqual({ from: "furniture_fixtures", to: "building_systems", n: 2 });
    expect(headline(stub!)).toBe("Most changed: Furniture and fixtures suggestions became Building systems 2 times.");
    const tie = matrices([
      { provider: "stub", suggested: "furniture_fixtures", final: "cleaning_safety", n: 1 },
      { provider: "stub", suggested: "electrical_av", final: "furniture_fixtures", n: 1 },
    ])[0]!;
    // Electrical and AV comes before Furniture and fixtures in CATEGORIES.
    expect(headline(tie)).toBe("Most changed: Electrical and AV suggestions became Furniture and fixtures 1 time.");
    const allKept = matrices([{ provider: "workers-ai", suggested: "cleaning_safety", final: "cleaning_safety", n: 3 }])[0]!;
    expect(headline(allKept)).toBe("Staff kept every suggestion.");
  });

  it("renders a real table with scoped headers, printed counts, kept on the diagonal and the row's share in hidden text", async () => {
    render(<KeptMatrix matrix={matrices(CELLS)[0]!} />);
    const table = screen.getByRole("table", { name: "Keyword stub (keyword-v1): suggested category by final category" });
    const headers = within(table).getAllByRole("columnheader");
    expect(headers.map((h) => h.getAttribute("scope"))).toEqual(["col", "col", "col", "col", "col", "col"]);
    expect(headers.map((h) => h.querySelector("abbr")?.getAttribute("title") ?? h.textContent)).toEqual([
      "Suggested",
      "Building systems",
      "Electrical and AV",
      "Furniture and fixtures",
      "Cleaning and safety",
      "Kept",
    ]);
    // A short word for wide screens and a shorter one for phones; CSS shows one of them.
    expect([...(headers[1]?.querySelectorAll("abbr > span") ?? [])].map((s) => s.textContent)).toEqual(["Building", "Bldg"]);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows.map((r) => within(r).getByRole("rowheader").getAttribute("scope"))).toEqual(["row", "row"]);
    const furniture = within(rows[1]!).getAllByRole("cell");
    expect(furniture.map((c) => c.textContent)).toEqual(["2, 25% of this row", "0, 0% of this row", "6, kept, 75% of this row", "0, 0% of this row", "kept 6 of 8"]);
    expect(furniture.map((c) => c.dataset.bin ?? "-")).toEqual(["2", "0", "4", "0", "-"]);
    expect(screen.getByText("Most changed: Furniture and fixtures suggestions became Building systems 2 times.")).toBeTruthy();
    expect(table.textContent).not.toMatch(/\bAI\b/);
    await expectNoAxeViolations();
  });

  it("labels each provider with its own label, AI only for Workers AI", () => {
    render(<KeptMatrix matrix={matrices(CELLS)[1]!} />);
    expect(screen.getByRole("table", { name: "Workers AI: suggested category by final category" })).toBeTruthy();
  });

  it("keys the shades in words", async () => {
    render(<ShareLegend />);
    expect(screen.getByText("Shade: share of the row.").parentElement?.textContent).toBe("Shade: share of the row.up to 20%up to 40%up to 60%up to 80%up to 100%");
    await expectNoAxeViolations();
  });
});
