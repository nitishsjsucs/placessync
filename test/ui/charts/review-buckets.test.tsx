import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReviewBuckets, bucketsSummary } from "../../../src/client/charts/ReviewBuckets.tsx";
import { expectNoAxeViolations } from "../axe.ts";

const BUCKETS = [
  { bucket: "under_1h", n: 3 },
  { bucket: "1h_to_4h", n: 5 },
  { bucket: "4h_to_24h", n: 2 },
  { bucket: "over_24h", n: 10 },
] as const;

describe("ReviewBuckets (VIZ-09)", () => {
  it("draws four columns with their counts and a summary, the over-24-hours one with an icon and words", async () => {
    render(<ReviewBuckets buckets={BUCKETS} median="Median time to review: 13 h 4 min (20 reviewed)." />);
    expect(screen.getByRole("heading", { name: "Time from submission to staff review" })).toBeTruthy();
    expect(screen.getByText("Median time to review: 13 h 4 min (20 reviewed).")).toBeTruthy();
    const chart = screen.getByRole("img", { name: "Reviews by time from submission: under 1 hour 3, 1 to 4 hours 5, 4 to 24 hours 2, over 24 hours 10." });
    const slots = [...chart.querySelectorAll<HTMLElement>("[data-bucket]")];
    expect(slots.map((s) => s.textContent)).toEqual(["3Under 1 hour", "51 to 4 hours", "24 to 24 hours", "10Over 24 hours"]);
    expect((slots[3]!.querySelector("[style]") as HTMLElement).style.height).toBe("100%");
    expect((slots[0]!.querySelector("[style]") as HTMLElement).style.height).toBe("30%");
    expect(within(slots[3]!).getByText("Over 24 hours").querySelector("svg[aria-hidden=true]")).toBeTruthy();
    await expectNoAxeViolations();
  });

  it("Show table gives the numbers", async () => {
    render(<ReviewBuckets buckets={BUCKETS} median="m" />);
    const toggle = screen.getByRole("button", { name: "Show table: time to review" });
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const table = screen.getByRole("table", { name: "Time from submission to staff review" });
    expect(within(table).getAllByRole("cell").map((c) => c.textContent)).toEqual(["Under 1 hour", "3", "1 to 4 hours", "5", "4 to 24 hours", "2", "Over 24 hours", "10"]);
    await expectNoAxeViolations();
  });

  it("says so when there are no reviews", () => {
    render(<ReviewBuckets buckets={BUCKETS.map((b) => ({ ...b, n: 0 }))} median="Median time to review: no reviews yet (0 reviewed)." />);
    expect(screen.getByText("No reviews in this range.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(bucketsSummary(BUCKETS)).toMatch(/^Reviews by time from submission: /);
  });
});
