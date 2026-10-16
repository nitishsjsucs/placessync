import { describe, expect, it } from "vitest";
import { barWidth, dailyColumns, percent, splitAtToday, weekdaysBetween } from "../../../src/client/charts/held-ahead.ts";
import type { UtilizationReport } from "../../../src/shared/api.ts";

const TODAY = "2026-10-08"; // a Thursday
const RANGE = { from: "2026-09-28", to: "2026-10-16" }; // 8 weekdays before today, 7 from today on
const space = (id: string, kind: "desk" | "room", active = true) => ({ id, name: id.replace("res_", ""), kind, active });
const RESOURCES = [space("res_d1", "desk"), space("res_d2", "desk"), space("res_d3", "desk", false), space("res_r1", "room")];
type Row = UtilizationReport["rows"][number];
const row = (resourceId: string, kind: "desk" | "room", date: string, bookedMin: number, bookings = 1): Row => ({ resourceId, kind, name: resourceId, date, bookings, bookedMin, utilization: bookedMin / 720 });
function report(rows: Row[], daily: UtilizationReport["daily"] = []): UtilizationReport {
  return { from: RANGE.from, to: RANGE.to, kind: null, rows, hourly: [], daily, totals: { bookings: 0, bookedMin: 0, resourceDays: 0, openMinutesPerDay: 720 } };
}

describe("splitAtToday (VIZ-07, VIZ-06)", () => {
  it("splits at today: earlier dates are held, today and later are ahead, each over its own weekdays", () => {
    const split = splitAtToday(report([row("res_d1", "desk", "2026-10-07", 720), row("res_d1", "desk", TODAY, 360), row("res_d1", "desk", "2026-10-15", 360)]), RESOURCES, TODAY, RANGE);
    expect(split.held).toEqual({ from: "2026-09-28", to: "2026-10-07", weekdays: 8 });
    expect(split.ahead).toEqual({ from: TODAY, to: "2026-10-16", weekdays: 7 });
    const d1 = split.spaces.find((s) => s.id === "res_d1")!;
    expect(d1.held).toEqual({ bookedMin: 720, bookings: 1, days: 1, utilization: 720 / (8 * 720) });
    expect(d1.ahead).toEqual({ bookedMin: 720, bookings: 2, days: 2, utilization: 720 / (7 * 720) });
    expect([d1.bookings, d1.days]).toEqual([3, 3]);
  });

  it("averages held utilization over the active spaces of a kind, zero-booked ones included and inactive ones left out", () => {
    const split = splitAtToday(report([row("res_d1", "desk", "2026-10-01", 2880 / 4), row("res_d3", "desk", "2026-10-01", 720)]), RESOURCES, TODAY, RANGE);
    // d1 is 720 of 5,760 held minutes (12.5%), d2 is 0, d3 is inactive.
    expect(split.kinds.desk.activeSpaces).toBe(2);
    expect(split.kinds.desk.heldUtilization).toBeCloseTo(0.0625, 10);
    expect(split.kinds.room).toMatchObject({ activeSpaces: 1, heldUtilization: 0 });
    // Every active space is listed, booked or not; the inactive one because it was booked.
    expect(split.spaces.map((s) => [s.id, s.active])).toEqual([
      ["res_d1", true],
      ["res_d2", true],
      ["res_d3", false],
      ["res_r1", true],
    ]);
  });

  it("leaves out an inactive space with no bookings in the range", () => {
    const split = splitAtToday(report([]), RESOURCES, TODAY, RANGE);
    expect(split.spaces.map((s) => s.id)).toEqual(["res_d1", "res_d2", "res_r1"]);
  });

  it("a range entirely in the past has no ahead part; one entirely ahead has no held part", () => {
    const past = splitAtToday(report([]), RESOURCES, TODAY, { from: "2026-09-01", to: "2026-09-30" });
    expect(past.ahead).toBeNull();
    expect(past.held?.weekdays).toBe(22);
    expect(past.spaces[0]?.ahead.utilization).toBeNull();
    const ahead = splitAtToday(report([]), RESOURCES, TODAY, { from: TODAY, to: "2026-10-22" });
    expect(ahead.held).toBeNull();
    expect(ahead.kinds.desk.heldUtilization).toBeNull();
    expect(ahead.kinds.desk.aheadUtilization).toBe(0);
  });

  it("counts bookings ahead and the cancelled share from the daily summary", () => {
    const split = splitAtToday(
      report([], [
        { date: "2026-10-01", resourceKind: "desk", confirmed: 30, cancelled: 3 },
        { date: TODAY, resourceKind: "desk", confirmed: 10, cancelled: 1 },
        { date: "2026-10-12", resourceKind: "room", confirmed: 4, cancelled: 0 },
      ]),
      RESOURCES,
      TODAY,
      RANGE,
    );
    expect([split.bookedAhead, split.cancelled, split.allBookings]).toEqual([14, 4, 48]);
  });

  it("draws shares on a fixed 0 to 100 domain", () => {
    expect(barWidth(0.38)).toBe("38%");
    expect(barWidth(0.004)).toBe("0.4%");
    expect(barWidth(1.2)).toBe("100%");
    expect(percent(0.375)).toBe("38%");
  });

  it("zero-fills weekdays and skips weekends in the daily columns", () => {
    const cols = dailyColumns(report([], [{ date: "2026-10-06", resourceKind: "desk", confirmed: 5, cancelled: 2 }]), "desk", { from: "2026-10-02", to: "2026-10-09" }, TODAY);
    expect(cols.map((c) => [c.date, c.confirmed, c.cancelled, c.ahead])).toEqual([
      ["2026-10-02", 0, 0, false],
      ["2026-10-05", 0, 0, false],
      ["2026-10-06", 5, 2, false],
      ["2026-10-07", 0, 0, false],
      ["2026-10-08", 0, 0, true],
      ["2026-10-09", 0, 0, true],
    ]);
    expect(weekdaysBetween("2026-10-03", "2026-10-04")).toBe(0);
  });
});
