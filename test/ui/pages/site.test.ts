import { describe, expect, it } from "vitest";
import { type SiteContext, dateUnavailableWord, firstBookableDate, todayHasClosed } from "../../../src/client/pages/site.ts";

// Thursday 2026-10-08 at hq (America/Los_Angeles, UTC-7 in October), open 07:00 to 19:00.
const SITE: SiteContext = { siteId: "hq", today: "2026-10-08", rules: { timezone: "America/Los_Angeles", openMin: 420, closeMin: 1140, horizonDays: 14 } };
const at = (hhmm: string, date = "2026-10-08") => {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  return Date.parse(`${date}T00:00:00Z`) + ((h + 7) * 60 + m) * 60_000;
};

describe("firstBookableDate (UX-01)", () => {
  it.each([
    ["08:00", "2026-10-08"],
    ["18:00", "2026-10-08"],
    ["18:30", "2026-10-08"],
    ["18:31", "2026-10-09"],
    ["18:45", "2026-10-09"],
    ["20:00", "2026-10-09"],
  ])("at %s site time it is %s", (time, expected) => {
    expect(firstBookableDate(SITE, at(time))).toBe(expected);
  });

  it("skips the weekend after a closed Friday", () => {
    const friday = { ...SITE, today: "2026-10-09" };
    expect(firstBookableDate(friday, at("19:30", "2026-10-09"))).toBe("2026-10-12");
    expect(todayHasClosed(friday, at("19:30", "2026-10-09"))).toBe(true);
  });

  it("todayHasClosed is false on a weekend, which dateDisabledReason already covers", () => {
    const saturday = { ...SITE, today: "2026-10-10" };
    expect(todayHasClosed(saturday, at("20:00", "2026-10-10"))).toBe(false);
    expect(firstBookableDate(saturday, at("20:00", "2026-10-10"))).toBe("2026-10-12");
  });
});

describe("dateUnavailableWord (UX-01)", () => {
  it.each([
    ["2026-10-07", "past"],
    ["2026-10-04", "past"],
    ["2026-10-10", "closed"],
    ["2026-10-24", "closed"],
    ["2026-10-23", "not open for booking yet"],
    ["2026-10-08", null],
    ["2026-10-22", null],
  ])("%s is %s", (date, word) => {
    expect(dateUnavailableWord(date, SITE)).toBe(word);
  });
});
