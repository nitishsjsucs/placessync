import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DayTimeline, REFETCH_THROTTLE_MS } from "../../../src/client/charts/DayTimeline.tsx";
import type { OpenRequestRef } from "../../../src/client/charts/day-timeline.ts";
import type { SiteContext } from "../../../src/client/pages/site.ts";
import type { StaffBookingsResponse } from "../../../src/shared/api.ts";
import { expectNoAxeViolations } from "../axe.ts";
import { FakeWebSocket } from "../fake-ws.ts";
import { setMediaMatches } from "../setup.ts";

const SITE: SiteContext = { siteId: "hq", today: "2026-10-08", rules: { timezone: "America/Los_Angeles", openMin: 420, closeMin: 1140, horizonDays: 14 } };
// 10:00 on Thursday 2026-10-08 in Los Angeles (UTC-7).
const TEN = Date.parse("2026-10-08T17:00:00.000Z");

const DATA: StaffBookingsResponse = {
  date: "2026-10-08",
  bookings: [
    { id: "rsv_1", resourceId: "res_2a01", resourceName: "Desk 2A-01", kind: "desk", employeeId: "emp_001", employeeName: "Fatima Bhatt", startMin: 450, endMin: 540, attendees: 1, title: null },
    { id: "rsv_2", resourceId: "res_alder", resourceName: "Alder", kind: "room", employeeId: "emp_002", employeeName: "Zara Ali", startMin: 540, endMin: 630, attendees: 3, title: "Team sync" },
    { id: "rsv_3", resourceId: "res_alder", resourceName: "Alder", kind: "room", employeeId: "emp_003", employeeName: "Noah Yamamoto", startMin: 750, endMin: 810, attendees: 4, title: null },
  ],
  resources: [
    { id: "res_2a01", name: "Desk 2A-01", kind: "desk", active: true },
    { id: "res_2a02", name: "Desk 2A-02", kind: "desk", active: true },
    { id: "res_alder", name: "Alder", kind: "room", active: true },
  ],
};
const REQUESTS: OpenRequestRef[] = [{ id: "req_seed_007", status: "awaiting_review", resourceId: "res_alder" }];

function renderTimeline(props: Partial<Parameters<typeof DayTimeline>[0]> = {}) {
  const onRefetch = props.onRefetch ?? vi.fn();
  const element = <DayTimeline site={SITE} data={DATA} openRequests={REQUESTS} onRefetch={onRefetch} {...props} />;
  const router = createMemoryRouter([{ path: "*", element }], { initialEntries: ["/staff?tab=today"] });
  const utils = render(<RouterProvider router={router} />);
  return { ...utils, onRefetch };
}
const chart = () => screen.getByRole("group", { name: /^Bookings by space, / });
const rowNamed = (start: string) => screen.getAllByRole("listitem").find((li) => li.getAttribute("aria-label")?.startsWith(start)) as HTMLElement;
const bars = (spaceId: string) => [...screen.getByTestId(`track-${spaceId}`).querySelectorAll<HTMLElement>("[data-start]")];
const axisLabels = () => [...chart().querySelectorAll<HTMLElement>("[data-tick]")].map((t) => t.textContent);

beforeEach(() => {
  FakeWebSocket.reset();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.useFakeTimers({ now: TEN });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("DayTimeline (VIZ-02)", () => {
  it("draws one row per space, rooms first, with bars placed by start and end", () => {
    renderTimeline();
    expect(screen.getByText("Now: 1 of 1 room and 0 of 2 desks in use.")).toBeTruthy();
    const rows = within(chart()).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Alder: booked 09:00 to 10:30 (Zara Ali, 3 attending, Team sync), 12:30 to 13:30 (Noah Yamamoto, 4 attending); in use until 10:30 (Zara Ali); next free 10:30 to 12:30; 1 open request",
      "Desk 2A-01: booked 07:30 to 09:00 (Fatima Bhatt, ended); free for the rest of the day",
      "Desk 2A-02: no bookings today; free for the rest of the day",
    ]);
    const [first, second] = bars("res_alder");
    // 09:00 is 120 of the 720 open minutes, 90 minutes long; 12:30 is 330 minutes in.
    expect(first?.style.left).toBe("calc(16.6667% + 1px)");
    expect(first?.style.width).toMatch(/^calc\(12\.5% - 2px\)$/);
    expect(second?.style.left).toBe("calc(45.8333% + 1px)");
    // A name that fits goes inside the bar; an ended booking carries no label, only words.
    expect(first?.textContent).toBe("Zara Ali");
    // "Noah Yamamoto" does not fit in 60 minutes on the narrowest track: tooltip and table only.
    expect(second?.textContent).toBe("");
    const [deskBar] = bars("res_2a01");
    expect(deskBar?.dataset.ended).toBe("true");
    expect(deskBar?.textContent).toBe("");
  });

  it("draws a Now rule at the site's time and moves it every minute without a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderTimeline();
    expect(screen.getByText("Now 10:00")).toBeTruthy();
    // On the narrowest track (1 px per minute) the Now label covers 09:00's label, so it goes.
    expect(axisLabels()).toEqual(["07:00", "11:00", "13:00", "15:00", "17:00"]);
    expect(screen.getByTestId("now-label").style.left).toBe(`${180 - 74 / 2}px`);
    const rule = screen.getByTestId("now-rule");
    expect(rule.style.getPropertyValue("--now")).toBe(String(180 / 720));
    await act(async () => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("Now 10:01")).toBeTruthy();
    expect(screen.getByTestId("now-rule").style.getPropertyValue("--now")).toBe(String(181 / 720));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps the Now label inside the axis late in the day", () => {
    // 18:50: centred on the line it would run past the chart's right edge.
    vi.setSystemTime(Date.parse("2026-10-09T01:50:00.000Z"));
    renderTimeline();
    expect(screen.getByText("Now 18:50")).toBeTruthy();
    expect(screen.getByTestId("now-label").style.left).toBe(`${720 - 74}px`);
    expect(axisLabels()).toEqual(["07:00", "09:00", "11:00", "13:00", "15:00", "17:00"]);
  });

  it("hides the Now rule outside open hours", () => {
    vi.setSystemTime(Date.parse("2026-10-08T13:00:00.000Z"));
    renderTimeline();
    expect(screen.queryByTestId("now-rule")).toBeNull();
    expect(screen.getByText("Opens at 07:00. 3 bookings today.")).toBeTruthy();
  });

  it("flags a space with an open request with an icon and a link to it named for the space", () => {
    renderTimeline({ openRequests: [...REQUESTS, { id: "req_seed_011", status: "assigned", resourceId: "res_2a01" }] });
    const link = within(rowNamed("Alder")).getByRole("link", { name: "1 open request for Alder" });
    expect(link.getAttribute("href")).toBe("/requests/req_seed_007");
    expect(link.querySelector("svg[aria-hidden=true]")).toBeTruthy();
    // The words on screen start the name; the space is added so a list of links tells them apart.
    expect(link.textContent).toBe("1 open request");
    expect(within(chart()).getAllByRole("link").map((a) => a.getAttribute("aria-label"))).toEqual(["1 open request for Alder", "1 open request for Desk 2A-01"]);
  });

  it("is one tab stop: arrows move between spaces and bookings, and the tooltip matches the row's words", () => {
    renderTimeline();
    const group = chart();
    expect(group.tabIndex).toBe(0);
    expect(within(group).queryAllByRole("button")).toEqual([]);
    act(() => group.focus());
    const tip = () => screen.getByTestId("timeline-tooltip").textContent;
    // Focus starts on the first space's booking nearest now.
    expect(tip()).toBe("Alder, 09:00 to 10:30, Zara Ali, 3 attending, Team sync");
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(tip()).toBe("Alder, 12:30 to 13:30, Noah Yamamoto, 4 attending");
    for (const part of tip()!.split(", ").slice(1)) expect(rowNamed("Alder").getAttribute("aria-label")).toContain(part);
    fireEvent.keyDown(group, { key: "Home" });
    expect(tip()).toContain("09:00 to 10:30");
    fireEvent.keyDown(group, { key: "End" });
    expect(tip()).toContain("12:30 to 13:30");
    fireEvent.keyDown(group, { key: "ArrowDown" });
    expect(tip()).toBe("Desk 2A-01, 07:30 to 09:00, Fatima Bhatt, ended");
    expect(screen.getByText("Desk 2A-01, 07:30 to 09:00, Fatima Bhatt, ended", { selector: "[aria-live] , [aria-live] *" })).toBeTruthy();
    fireEvent.keyDown(group, { key: "ArrowDown" });
    // A space with no bookings: no tooltip, the row itself is announced.
    expect(screen.queryByTestId("timeline-tooltip")).toBeNull();
    expect(document.querySelector("[aria-live=polite]")?.textContent).toBe("Desk 2A-02: no bookings today");
    fireEvent.keyDown(group, { key: "ArrowUp" });
    fireEvent.keyDown(group, { key: "ArrowUp" });
    expect(tip()).toContain("Alder");
  });

  it("names both bar colors in a legend beside the chart, never in the table or the cards", () => {
    const { unmount } = renderTimeline();
    const legend = screen.getByTestId("timeline-legend");
    expect(legend.textContent).toBe("BookedEnded before now");
    // The swatches are decoration: the words carry the meaning.
    const swatches = [...legend.querySelectorAll("[aria-hidden=true]")];
    expect(swatches).toHaveLength(2);
    expect(swatches[1]?.className).toMatch(/ended/);
    // The ended booking's bar uses the same class as its swatch.
    expect(bars("res_2a01")[0]?.className).toMatch(/ended/);
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    expect(screen.queryByTestId("timeline-legend")).toBeNull();
    unmount();
    setMediaMatches("(max-width: 639px)", true);
    renderTimeline();
    expect(screen.queryByTestId("timeline-legend")).toBeNull();
  });

  it("Show as table swaps in the bookings table with the same bookings", () => {
    renderTimeline();
    const toggle = screen.getByRole("button", { name: "Show as table" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    const table = screen.getByRole("table", { name: "Bookings today, 2026-10-08" });
    expect(
      within(table)
        .getAllByRole("row")
        .slice(1)
        .map((r) => within(r).getAllByRole("cell").map((c) => c.textContent)),
    ).toEqual([
      ["07:30 to 09:00", "Desk 2A-01", "Fatima Bhatt", "Desk, ended"],
      ["09:00 to 10:30", "Alder", "Zara Ali", "3 attending, Team sync"],
      ["12:30 to 13:30", "Alder", "Noah Yamamoto", "4 attending"],
    ]);
    expect(screen.queryByRole("group", { name: /^Bookings by space/ })).toBeNull();
  });

  it("says an empty day or a weekend in words, and opens no socket on a weekend", () => {
    const { unmount } = renderTimeline({ data: { ...DATA, bookings: [] } });
    expect(screen.getByText("No bookings today; every space is free.")).toBeTruthy();
    unmount();
    FakeWebSocket.reset();
    renderTimeline({ site: { ...SITE, today: "2026-10-10" }, data: { ...DATA, date: "2026-10-10", bookings: [] } });
    expect(screen.getByText("The site is closed today.")).toBeTruthy();
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("keeps the last render dimmed while refetching", () => {
    const { container } = renderTimeline({ refreshing: true });
    const root = container.querySelector("[aria-busy=true]");
    expect(root).toBeTruthy();
    expect(root?.className).toMatch(/refreshing/);
    expect(chart()).toBeTruthy();
  });

  it("follows the live snapshot: a released booking goes, a new one shows as Booked and asks for one refetch per 30 s", async () => {
    const { onRefetch } = renderTimeline();
    const ws = FakeWebSocket.last();
    await act(async () => ws.open());
    expect(ws.subscriptions()).toEqual(["2026-10-08"]);
    await act(async () =>
      ws.receive({
        type: "snapshot",
        date: "2026-10-08",
        dateVersion: 5,
        ledgerVersion: 9,
        // Noah's 12:30 booking was released; someone booked Desk 2A-02 at 14:00.
        busy: { res_alder: [{ startMin: 540, endMin: 630, mine: false }], res_2a01: [{ startMin: 450, endMin: 540, mine: false }], res_2a02: [{ startMin: 840, endMin: 900, mine: false }] },
      }),
    );
    expect(bars("res_alder")).toHaveLength(1);
    expect(bars("res_2a02").map((b) => b.textContent)).toEqual(["Booked"]);
    await act(async () => vi.advanceTimersByTime(0));
    expect(onRefetch).toHaveBeenCalledTimes(1);
    // Another unnamed booking within 30 s waits for the throttle.
    await act(async () => ws.receive({ type: "delta", date: "2026-10-08", dateVersion: 6, ledgerVersion: 10, op: "booked", resourceId: "res_2a02", startMin: 960, endMin: 1020, mine: false }));
    await act(async () => vi.advanceTimersByTime(REFETCH_THROTTLE_MS - 1_000));
    expect(onRefetch).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTime(1_000));
    expect(onRefetch).toHaveBeenCalledTimes(2);
  });

  it("under 640 px lists the spaces as cards that say the same in words", () => {
    setMediaMatches("(max-width: 639px)", true);
    renderTimeline();
    const cards = within(screen.getByRole("list", { name: /^Spaces today/ })).getAllByRole("listitem");
    expect(cards.map((c) => c.textContent)).toEqual([
      "Alder: in use until 10:30 (Zara Ali); next free 10:30 to 12:30" + "2 bookings today" + "1 open request",
      "Desk 2A-01: free for the rest of the day" + "1 booking today",
      "Desk 2A-02: free for the rest of the day" + "No bookings today",
    ]);
    expect(screen.queryByRole("group", { name: /^Bookings by space/ })).toBeNull();
  });

  describe("where the chart scrolls inside its frame (a tablet)", () => {
    // A model of Chromium's layout at 768 px: the frame shows 734 px, the space names take
    // 152 px, and the track is 720 px at 1 px per minute, so 17:30 is past the right edge.
    const FRAME_LEFT = 16;
    const FRAME_WIDTH = 734;
    const NAMES = 152;
    const TIP_WIDTH = 300;
    const LATE: StaffBookingsResponse = {
      ...DATA,
      bookings: [...DATA.bookings, { id: "rsv_4", resourceId: "res_2a02", resourceName: "Desk 2A-02", kind: "desk", employeeId: "emp_004", employeeName: "Leo Gupta", startMin: 1050, endMin: 1140, attendees: 1, title: null }],
    };
    let scrollIntoView: ReturnType<typeof vi.fn>;

    function layOut() {
      const frame = screen.getByTestId("timeline-frame");
      let scrollLeft = 0;
      Object.defineProperty(frame, "scrollLeft", { configurable: true, get: () => scrollLeft, set: (v: number) => (scrollLeft = Math.max(0, Math.min(NAMES + 720 - FRAME_WIDTH, v))) });
      Object.defineProperty(frame, "clientWidth", { configurable: true, value: FRAME_WIDTH });
      const names = frame.querySelector<HTMLElement>("[aria-hidden=true] > span");
      Object.defineProperty(names, "offsetWidth", { configurable: true, value: NAMES });
      const trackLeft = () => FRAME_LEFT + NAMES - scrollLeft;
      const box = (left: number, width: number) => ({ left, right: left + width, width, top: 0, bottom: 20, height: 20, x: left, y: 0, toJSON: () => ({}) }) as DOMRect;
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        if (this === frame) return box(FRAME_LEFT, FRAME_WIDTH);
        if (this.dataset.start) return box(trackLeft() + Number(this.dataset.start) - 420, Number(this.dataset.end) - Number(this.dataset.start));
        if (this.dataset.testid === "timeline-tooltip") {
          const shift = Number(/translateX\((-?[\d.]+)px\)/.exec(this.style.transform)?.[1] ?? 0);
          const left = this.style.left ? (parseFloat(this.style.left) / 100) * 720 : 720 - (parseFloat(this.style.right) / 100) * 720 - TIP_WIDTH;
          return box(trackLeft() + left + shift, TIP_WIDTH);
        }
        return box(0, 0);
      });
      return frame;
    }

    beforeEach(() => {
      scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView as unknown as Element["scrollIntoView"];
    });
    afterEach(() => {
      vi.restoreAllMocks();
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    it("scrolls a booking past the frame's edge into view when the keyboard focuses it", () => {
      renderTimeline({ data: LATE });
      const frame = layOut();
      act(() => chart().focus());
      expect(frame.scrollLeft).toBe(0);
      fireEvent.keyDown(chart(), { key: "ArrowDown" });
      fireEvent.keyDown(chart(), { key: "ArrowDown" });
      fireEvent.keyDown(chart(), { key: "End" });
      expect(screen.getByTestId("timeline-tooltip").textContent).toBe("Desk 2A-02, 17:30 to 19:00, Leo Gupta");
      // The bar ran from 798 to 888 px with the frame's visible part ending at 750 px.
      const bar = bars("res_2a02")[0] as HTMLElement;
      expect(bar.dataset.focused).toBe("bar");
      const r = bar.getBoundingClientRect();
      expect(frame.scrollLeft).toBeGreaterThan(0);
      expect(r.left).toBeGreaterThanOrEqual(FRAME_LEFT + NAMES);
      expect(r.right).toBeLessThanOrEqual(FRAME_LEFT + FRAME_WIDTH);
      // Its text beside it is inside the visible part too.
      const t = screen.getByTestId("timeline-tooltip").getBoundingClientRect();
      expect(t.left).toBeGreaterThanOrEqual(FRAME_LEFT + NAMES);
      expect(t.right).toBeLessThanOrEqual(FRAME_LEFT + FRAME_WIDTH);
      // Each move also brings the focused row into the page's view.
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", inline: "nearest" });
      expect((scrollIntoView.mock.contexts.at(-1) as HTMLElement).getAttribute("aria-label")).toMatch(/^Desk 2A-02: /);
      // Back to the first booking of the day: the frame scrolls back to show its start.
      fireEvent.keyDown(chart(), { key: "ArrowUp" });
      fireEvent.keyDown(chart(), { key: "Home" });
      expect(bars("res_2a01")[0]?.getBoundingClientRect().left).toBeGreaterThanOrEqual(FRAME_LEFT + NAMES);
    });

    it("keeps a hovered booking's text inside the frame's visible part without scrolling", () => {
      renderTimeline({ data: LATE });
      const frame = layOut();
      fireEvent.pointerEnter(bars("res_2a02")[0] as HTMLElement);
      const tip = screen.getByTestId("timeline-tooltip");
      expect(frame.scrollLeft).toBe(0);
      // Anchored to the bar's end at 888 px, it is moved left to end inside the frame.
      expect(tip.style.transform).toMatch(/^translateX\(-\d+(\.\d+)?px\)$/);
      expect(tip.getBoundingClientRect().right).toBeLessThanOrEqual(FRAME_LEFT + FRAME_WIDTH);
      expect(tip.style.maxWidth).toBe(`min(22rem, ${FRAME_WIDTH - NAMES - 8}px)`);
      const before = tip.style.transform;
      // Scrolled by hand to the end, the bar's end meets the frame's: only the edge gap is left.
      frame.scrollLeft = 1000;
      fireEvent.scroll(frame);
      expect(before).not.toBe("translateX(-4px)");
      expect(tip.style.transform).toBe("translateX(-4px)");
    });
  });

  it("has no axe violations as a chart, as cards and as a table", async () => {
    vi.useRealTimers();
    const { unmount } = renderTimeline();
    await expectNoAxeViolations();
    fireEvent.click(screen.getByRole("button", { name: "Show as table" }));
    await expectNoAxeViolations();
    unmount();
    setMediaMatches("(max-width: 639px)", true);
    renderTimeline();
    await expectNoAxeViolations();
  });
});
