import { describe, expect, it } from "vitest";
import { countOverlappingPairs, countOverlappingPairsBy, fitsWindow, freeWindows, mergeIntervals, overlaps } from "../../src/shared/intervals.ts";
import { intBetween, mulberry32, pick, shuffle, weighted } from "../../src/shared/rng.ts";
import {
  addBusinessDays,
  addDays,
  dayOfWeek,
  formatMinutes,
  isValidDate,
  previousBusinessDays,
  siteClock,
  slotsFor,
  weekStartOf,
} from "../../src/shared/time.ts";

describe("rng", () => {
  it("is deterministic per seed and differs across seeds", () => {
    const a = mulberry32(20261008);
    const b = mulberry32(20261008);
    const c = mulberry32(1);
    const sa = Array.from({ length: 5 }, a);
    expect(Array.from({ length: 5 }, b)).toEqual(sa);
    expect(Array.from({ length: 5 }, c)).not.toEqual(sa);
    for (const x of sa) expect(x >= 0 && x < 1).toBe(true);
  });

  it("helpers stay in range", () => {
    const r = mulberry32(7);
    for (let i = 0; i < 500; i++) {
      const n = intBetween(r, 3, 6);
      expect(n >= 3 && n <= 6).toBe(true);
    }
    expect(["a", "b"]).toContain(pick(r, ["a", "b"]));
    expect(weighted(r, [["only", 1]] as const)).toBe("only");
    expect(shuffle(r, [1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("time", () => {
  it("formats the site clock with Intl in the site zone", () => {
    // SPEC 20 item 13: 2026-11-01T09:30Z is 01:30 in Los Angeles.
    expect(siteClock("America/Los_Angeles", Date.parse("2026-11-01T09:30:00Z"))).toEqual({ date: "2026-11-01", minutes: 90 });
    expect(siteClock("America/Los_Angeles", Date.parse("2026-10-09T05:30:00Z"))).toEqual({ date: "2026-10-08", minutes: 1350 });
  });

  it("does calendar arithmetic", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(dayOfWeek("2026-10-08")).toBe(4);
    expect(addBusinessDays("2026-10-08", 2)).toBe("2026-10-12");
    expect(addBusinessDays("2026-10-08", 3)).toBe("2026-10-13");
    expect(previousBusinessDays("2026-10-08", 3)).toEqual(["2026-10-05", "2026-10-06", "2026-10-07"]);
    expect(weekStartOf("2026-10-08")).toBe("2026-10-05");
    expect(weekStartOf("2026-10-11")).toBe("2026-10-05");
    expect(weekStartOf("2026-10-05")).toBe("2026-10-05");
    expect(isValidDate("2026-02-29")).toBe(false);
    expect(isValidDate("2028-02-29")).toBe(true);
  });

  it("maps minutes to 15-minute slots", () => {
    expect(slotsFor(540, 600)).toEqual([36, 37, 38, 39]);
    expect(formatMinutes(545)).toBe("09:05");
  });
});

describe("intervals", () => {
  it("treats adjacency as non-overlapping", () => {
    expect(overlaps({ startMin: 540, endMin: 600 }, { startMin: 600, endMin: 660 })).toBe(false);
    expect(overlaps({ startMin: 540, endMin: 601 }, { startMin: 600, endMin: 660 })).toBe(true);
  });

  it("merges and complements", () => {
    const busy = [
      { startMin: 600, endMin: 660 },
      { startMin: 540, endMin: 600 },
      { startMin: 900, endMin: 960 },
    ];
    expect(mergeIntervals(busy)).toEqual([
      { startMin: 540, endMin: 660 },
      { startMin: 900, endMin: 960 },
    ]);
    const free = freeWindows(busy, 420, 1140);
    expect(free).toEqual([
      { startMin: 420, endMin: 540 },
      { startMin: 660, endMin: 900 },
      { startMin: 960, endMin: 1140 },
    ]);
    expect(fitsWindow(free, { startMin: 660, endMin: 900 })).toBe(true);
    expect(fitsWindow(free, { startMin: 645, endMin: 700 })).toBe(false);
  });

  it("counts overlapping pairs exactly", () => {
    expect(countOverlappingPairs([])).toBe(0);
    expect(
      countOverlappingPairs([
        { startMin: 0, endMin: 60 },
        { startMin: 60, endMin: 120 },
      ]),
    ).toBe(0);
    // Three mutually overlapping intervals make three pairs.
    expect(
      countOverlappingPairs([
        { startMin: 0, endMin: 60 },
        { startMin: 30, endMin: 90 },
        { startMin: 45, endMin: 50 },
      ]),
    ).toBe(3);
    expect(
      countOverlappingPairsBy(
        [
          { r: "a", startMin: 0, endMin: 60 },
          { r: "b", startMin: 0, endMin: 60 },
          { r: "a", startMin: 30, endMin: 40 },
        ],
        (x) => x.r,
      ),
    ).toBe(1);
  });
});
