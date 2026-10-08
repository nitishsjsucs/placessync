import { describe, expect, it } from "vitest";
import { type ReserveInput, type RuleResource, type SiteRules, hasStarted, validate } from "../../src/shared/rules.ts";

const HQ: SiteRules = { timezone: "America/Los_Angeles", openMin: 420, closeMin: 1140, horizonDays: 14 };
// Thursday 2026-10-08, 08:00 in Los Angeles (PDT, UTC-7).
const NOW = Date.parse("2026-10-08T15:00:00Z");
const desk: RuleResource = { id: "res_2a01", kind: "desk", capacity: 1, active: true };
const room: RuleResource = { id: "res_sequoia", kind: "room", capacity: 8, active: true };

const codes = (input: Partial<ReserveInput>, resource = desk, rules = HQ, now = NOW) =>
  validate({ resourceId: resource.id, date: "2026-10-09", startMin: 540, endMin: 660, ...input }, resource, rules, now).map(
    (i) => i.code,
  );

describe("rules.validate (SPEC 7.1)", () => {
  it("accepts a plain desk booking", () => {
    expect(codes({})).toEqual([]);
  });

  it("accepts a 07:00 start and a 19:00 end", () => {
    expect(codes({ startMin: 420, endMin: 480 })).toEqual([]);
    expect(codes({ startMin: 1080, endMin: 1140 })).toEqual([]);
  });

  it("rejects 18:45 to 19:15 (past close)", () => {
    expect(codes({ startMin: 1125, endMin: 1155 }, room)).toContain("after_close");
  });

  it("rejects a start before opening", () => {
    expect(codes({ startMin: 405, endMin: 480 })).toContain("before_open");
  });

  it("rejects weekends", () => {
    expect(codes({ date: "2026-10-10" })).toContain("weekend");
    expect(codes({ date: "2026-10-11" })).toContain("weekend");
  });

  it("accepts horizon day 14 and rejects day 15", () => {
    expect(codes({ date: "2026-10-22" })).toEqual([]);
    expect(codes({ date: "2026-10-23" })).toContain("beyond_horizon");
  });

  it("rejects past dates and malformed dates", () => {
    expect(codes({ date: "2026-10-07" })).toContain("date_in_past");
    expect(codes({ date: "2026-02-30" })).toContain("invalid_date");
    expect(codes({ date: "10/09/2026" })).toContain("invalid_date");
  });

  it("requires a start strictly after now when booking today", () => {
    expect(codes({ date: "2026-10-08", startMin: 480, endMin: 540 })).toContain("start_in_past");
    expect(codes({ date: "2026-10-08", startMin: 495, endMin: 600 })).toEqual([]);
  });

  it("requires 15-minute boundaries", () => {
    expect(codes({ startMin: 545 })).toContain("not_on_slot");
    expect(codes({ endMin: 661 })).toContain("not_on_slot");
  });

  it("enforces desk duration 60 to 600 minutes", () => {
    expect(codes({ startMin: 540, endMin: 585 })).toContain("duration");
    expect(codes({ startMin: 540, endMin: 600 })).toEqual([]);
    expect(codes({ startMin: 420, endMin: 1020 })).toEqual([]);
    expect(codes({ startMin: 420, endMin: 1035 })).toContain("duration");
  });

  it("enforces room duration 15 to 240 minutes", () => {
    expect(codes({ startMin: 540, endMin: 555 }, room)).toEqual([]);
    expect(codes({ startMin: 540, endMin: 780 }, room)).toEqual([]);
    expect(codes({ startMin: 540, endMin: 795 }, room)).toContain("duration");
  });

  it("rejects end before or equal to start", () => {
    expect(codes({ startMin: 600, endMin: 600 })).toContain("end_before_start");
  });

  it("desks take exactly one attendee; rooms 1..capacity", () => {
    expect(codes({ attendees: 2 })).toContain("attendees");
    expect(codes({ attendees: 8, endMin: 600 }, room)).toEqual([]);
    expect(codes({ attendees: 9, endMin: 600 }, room)).toContain("over_capacity");
    expect(codes({ attendees: 0, endMin: 600 }, room)).toContain("attendees");
  });

  it("titles are for rooms only and at most 80 characters", () => {
    expect(codes({ title: "Standup" })).toContain("title_desk");
    expect(codes({ title: "Standup", endMin: 600 }, room)).toEqual([]);
    expect(codes({ title: "x".repeat(81), endMin: 600 }, room)).toContain("title_length");
  });

  it("rejects inactive resources", () => {
    expect(codes({}, { ...desk, active: false })).toContain("inactive_resource");
  });

  it("reads hours and horizon from SiteRules, not constants", () => {
    const short: SiteRules = { timezone: "America/Los_Angeles", openMin: 480, closeMin: 1020, horizonDays: 7 };
    expect(codes({ startMin: 420, endMin: 540 }, desk, short)).toContain("before_open");
    expect(codes({ startMin: 960, endMin: 1080 }, desk, short)).toContain("after_close");
    expect(codes({ date: "2026-10-15" }, desk, short)).toEqual([]);
    expect(codes({ date: "2026-10-16" }, desk, short)).toContain("beyond_horizon");
  });

  it("uses the site time zone for today", () => {
    // 2026-10-09T05:30Z is still 22:30 on 2026-10-08 in Los Angeles.
    const lateEvening = Date.parse("2026-10-09T05:30:00Z");
    expect(codes({ date: "2026-10-08", startMin: 540, endMin: 660 }, desk, HQ, lateEvening)).toContain("start_in_past");
    expect(codes({ date: "2026-10-09" }, desk, HQ, lateEvening)).toEqual([]);
  });
});

describe("rules.hasStarted", () => {
  it("compares in site-local time", () => {
    expect(hasStarted("2026-10-08", 480, HQ, NOW)).toBe(true);
    expect(hasStarted("2026-10-08", 495, HQ, NOW)).toBe(false);
    expect(hasStarted("2026-10-07", 900, HQ, NOW)).toBe(true);
    expect(hasStarted("2026-10-09", 420, HQ, NOW)).toBe(false);
  });
});
