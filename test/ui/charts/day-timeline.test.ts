import { describe, expect, it } from "vitest";
import {
  type Space,
  type StaffBooking,
  axisLayout,
  barText,
  buildRows,
  headline,
  labelFits,
  openRequestLink,
  place,
  rowSentence,
  summarize,
} from "../../../src/client/charts/day-timeline.ts";

const OPEN = 420;
const CLOSE = 1140;
const spaces: Space[] = [
  { id: "res_2a10", name: "Desk 2A-10", kind: "desk", active: true },
  { id: "res_2a02", name: "Desk 2A-02", kind: "desk", active: true },
  { id: "res_sequoia", name: "Sequoia", kind: "room", active: true },
  { id: "res_alder", name: "Alder", kind: "room", active: true },
  { id: "res_3b03", name: "Desk 3B-03", kind: "desk", active: false },
];
let n = 0;
function booking(resourceId: string, startMin: number, endMin: number, employeeName = "Fatima Bhatt", extra: Partial<StaffBooking> = {}): StaffBooking {
  const space = spaces.find((s) => s.id === resourceId);
  return {
    id: `rsv_${++n}`,
    resourceId,
    resourceName: space?.name ?? resourceId,
    kind: space?.kind ?? "desk",
    employeeId: "emp_001",
    employeeName,
    startMin,
    endMin,
    attendees: space?.kind === "room" ? 3 : 1,
    title: null,
    ...extra,
  };
}

describe("buildRows (VIZ-02)", () => {
  it("orders rooms first, then desks, each by name with numbers in order, and keeps a booked inactive space", () => {
    const { rows } = buildRows(spaces, [booking("res_3b03", 540, 600)], null);
    expect(rows.map((r) => r.space.name)).toEqual(["Alder", "Sequoia", "Desk 2A-02", "Desk 2A-10", "Desk 3B-03"]);
    expect(rows.at(-1)?.space.active).toBe(false);
  });

  it("without the resources field, builds rows from the bookings", () => {
    const { rows } = buildRows(undefined, [booking("res_alder", 600, 660), booking("res_2a02", 540, 600)], null);
    expect(rows.map((r) => [r.space.name, r.space.kind, r.bars.length])).toEqual([
      ["Alder", "room", 1],
      ["Desk 2A-02", "desk", 1],
    ]);
  });

  it("with a live snapshot: drops a released booking, and draws an unnamed live interval as Booked", () => {
    const kept = booking("res_alder", 600, 660);
    const released = booking("res_alder", 720, 780);
    const built = buildRows(spaces, [kept, released], { res_alder: [{ startMin: 600, endMin: 660, mine: false }, { startMin: 840, endMin: 900, mine: false }] });
    const alder = built.rows.find((r) => r.space.id === "res_alder");
    expect(alder?.bars.map((b) => [b.startMin, b.endMin, b.booking?.id ?? null])).toEqual([
      [600, 660, kept.id],
      [840, 900, null],
    ]);
    expect(built.unnamed).toBe(1);
    expect(buildRows(spaces, [kept], { res_alder: [{ startMin: 600, endMin: 660, mine: false }] }).unnamed).toBe(0);
  });

  it("the order never changes with the bookings or the time", () => {
    const a = buildRows(spaces, [], null).rows.map((r) => r.space.id);
    const b = buildRows(spaces, [booking("res_2a10", 420, 1140), booking("res_alder", 900, 960)], null).rows.map((r) => r.space.id);
    expect(b).toEqual(a);
  });
});

describe("summarize and headline (VIZ-02)", () => {
  const rowOf = (bookings: StaffBooking[]) => buildRows(spaces.slice(3, 4), bookings, null).rows[0]!;

  it("in use: until the end of this booking, then the next free gap after the back-to-back run", () => {
    const row = rowOf([booking("res_alder", 540, 630, "Fatima Bhatt"), booking("res_alder", 630, 690, "Zara Haddad"), booking("res_alder", 750, 810)]);
    expect(summarize(row, 600, OPEN, CLOSE)).toBe("in use until 10:30 (Fatima Bhatt); next free 11:30 to 12:30");
    expect(summarize(rowOf([booking("res_alder", 540, 630)]), 600, OPEN, CLOSE)).toBe("in use until 10:30 (Fatima Bhatt); free from 10:30 for the rest of the day");
    expect(summarize(rowOf([booking("res_alder", 1080, 1140)]), 1100, OPEN, CLOSE)).toBe("in use until 19:00 (Fatima Bhatt); no free time left today");
  });

  it("free now until the next booking, or for the rest of the day", () => {
    expect(summarize(rowOf([booking("res_alder", 750, 810)]), 600, OPEN, CLOSE)).toBe("free now until 12:30");
    expect(summarize(rowOf([booking("res_alder", 450, 500)]), 600, OPEN, CLOSE)).toBe("free for the rest of the day");
    expect(summarize(rowOf([]), 600, OPEN, CLOSE)).toBe("free for the rest of the day");
  });

  it("outside open hours: closed now, with the first booking before opening", () => {
    expect(summarize(rowOf([booking("res_alder", 450, 540)]), 300, OPEN, CLOSE)).toBe("closed now; next booking 07:30");
    expect(summarize(rowOf([]), 300, OPEN, CLOSE)).toBe("closed now");
    expect(summarize(rowOf([booking("res_alder", 450, 540)]), 1150, OPEN, CLOSE)).toBe("closed now");
  });

  it("counts spaces in use now by kind", () => {
    const { rows } = buildRows(spaces, [booking("res_alder", 540, 660), booking("res_2a02", 600, 700), booking("res_2a10", 400, 500)], null);
    expect(headline(rows, 610, OPEN, CLOSE)).toBe("Now: 1 of 2 rooms and 1 of 3 desks in use.");
    expect(headline(rows, 300, OPEN, CLOSE)).toBe("Opens at 07:00. 3 bookings today.");
    expect(headline(rows, 1200, OPEN, CLOSE)).toBe("Closed now. 3 bookings today.");
  });
});

describe("words, links and geometry (VIZ-02)", () => {
  it("names each booking for the tooltip, the row and the table, and says ended", () => {
    const room = booking("res_alder", 750, 810, "Zara Haddad", { title: "Team sync" });
    const desk = booking("res_2a02", 450, 540);
    const { rows } = buildRows(spaces, [room, desk], { res_alder: [{ startMin: 750, endMin: 810, mine: false }, { startMin: 900, endMin: 960, mine: false }], res_2a02: [{ startMin: 450, endMin: 540, mine: false }] });
    const alder = rows.find((r) => r.space.id === "res_alder")!;
    const deskRow = rows.find((r) => r.space.id === "res_2a02")!;
    expect(barText(alder.space, alder.bars[0]!, 600)).toBe("Alder, 12:30 to 13:30, Zara Haddad, 3 attending, Team sync");
    expect(barText(alder.space, alder.bars[1]!, 600)).toBe("Alder, 15:00 to 16:00, Booked");
    expect(barText(deskRow.space, deskRow.bars[0]!, 600)).toBe("Desk 2A-02, 07:30 to 09:00, Fatima Bhatt, ended");
    expect(rowSentence(alder, 600, summarize(alder, 600, OPEN, CLOSE), 1)).toBe(
      "Alder: booked 12:30 to 13:30 (Zara Haddad, 3 attending, Team sync), 15:00 to 16:00 (Booked); free now until 12:30; 1 open request",
    );
    const inactive = buildRows(spaces, [booking("res_3b03", 540, 600)], null).rows.at(-1)!;
    expect(rowSentence(inactive, 700, "free for the rest of the day", 2)).toBe("Desk 3B-03 (inactive): booked 09:00 to 10:00 (Fatima Bhatt, ended); free for the rest of the day; 2 open requests");
    expect(rowSentence(buildRows(spaces, [], null).rows[0]!, null, "free for the rest of the day", 0)).toBe("Alder: no bookings today; free for the rest of the day");
  });

  it("links one open request to itself and several to the tab that lists them", () => {
    expect(openRequestLink([])).toBeNull();
    expect(openRequestLink([{ id: "req_1", status: "awaiting_review", resourceId: "res_alder" }])).toBe("/requests/req_1");
    expect(
      openRequestLink([
        { id: "req_1", status: "awaiting_review", resourceId: "res_alder" },
        { id: "req_2", status: "in_progress", resourceId: "res_alder" },
      ]),
    ).toBe("/staff?tab=working");
    expect(
      openRequestLink([
        { id: "req_1", status: "awaiting_review", resourceId: "res_alder" },
        { id: "req_2", status: "submitted", resourceId: "res_alder" },
      ]),
    ).toBe("/staff");
  });

  it("places bars across open hours and clamps anything outside them", () => {
    expect(place(420, 480, OPEN, CLOSE)).toEqual({ left: 0, width: (60 / 720) * 100 });
    expect(place(780, 840, OPEN, CLOSE)).toEqual({ left: 50, width: (60 / 720) * 100 });
    expect(place(1100, 1200, OPEN, CLOSE)).toEqual({ left: (680 / 720) * 100, width: (40 / 720) * 100 });
  });

  it("puts a name inside a bar only when it fits on the narrowest track", () => {
    expect(labelFits("Zara", 60, 1)).toBe(true);
    expect(labelFits("Fatima Bhatt", 60, 1)).toBe(false);
    expect(labelFits("Fatima Bhatt", 120, 1)).toBe(true);
  });
});

describe("the time axis in pixels (VIZ-02)", () => {
  const PILL = 74;
  const TICK = 34;
  // Measured in Chromium: the track is 1,094 px at 1280 px and 720 px (1 px per minute) at 768 px.
  const at = (track: number, nowMin: number | null) => axisLayout(OPEN, CLOSE, nowMin, { track, pill: PILL, tick: TICK });
  const x = (track: number, m: number) => ((m - OPEN) / (CLOSE - OPEN)) * track;
  /** No kept hour label's box meets the Now label's box, and the Now label stays inside the track. */
  function clear(track: number, nowMin: number) {
    const { ticks, pillLeft } = at(track, nowMin);
    expect(pillLeft).not.toBeNull();
    const left = pillLeft as number;
    expect(left).toBeGreaterThanOrEqual(0);
    expect(left + PILL).toBeLessThanOrEqual(track);
    for (const m of ticks) {
      const tl = x(track, m) + 4;
      expect(tl + TICK <= left || tl >= left + PILL, `label ${m} against Now at ${nowMin}`).toBe(true);
    }
    return ticks;
  }

  it("labels every two hours when there is no Now label", () => {
    expect(at(1094, null)).toEqual({ ticks: [420, 540, 660, 780, 900, 1020], pillLeft: null });
  });

  it("leaves out an hour label the Now label would cover, by width in pixels, not minutes", () => {
    // 11:45 at 1280 px: 45 minutes from 11:00, but its label runs under the Now label.
    expect(clear(1094, 705)).toEqual([420, 540, 780, 900, 1020]);
    // 15:46 at 1280 px: 46 minutes from 15:00.
    expect(clear(1094, 946)).toEqual([420, 540, 660, 780, 1020]);
    // 11:59 at 768 px (1 px per minute): 59 minutes away is still too close.
    expect(clear(720, 719)).toEqual([420, 540, 780, 900, 1020]);
    // 14:40, the screenshot time: 13:00 stays.
    expect(clear(1094, 880)).toEqual([420, 540, 660, 780, 1020]);
  });

  it("keeps the Now label inside the track at both ends of the day", () => {
    // 18:50: centred it would run past the chart's right edge, so it ends at the track's end.
    expect(at(1094, 1130).pillLeft).toBe(1094 - PILL);
    expect(clear(1094, 1130)).toEqual([420, 540, 660, 780, 900, 1020]);
    // 07:05: it starts at the track's start, over the 07:00 label, which is left out.
    expect(at(720, 425).pillLeft).toBe(0);
    expect(clear(720, 425)).toEqual([540, 660, 780, 900, 1020]);
  });

  it("drops a label that would run past the end of a very narrow track", () => {
    expect(at(1000, null).ticks).toContain(1020);
    expect(axisLayout(OPEN, CLOSE, null, { track: 200, pill: PILL, tick: 40 }).ticks).not.toContain(1020);
  });
});
