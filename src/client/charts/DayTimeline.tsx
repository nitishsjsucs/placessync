// Today's bookings as a day timeline (VIZ-02), mounted only inside the staff page's
// "Today's bookings" tab. One row per space (rooms first, then desks), a bar per booking
// across open hours, a "Now" rule that moves every minute without a request, and a flag
// on spaces with an open facilities request. Under 640 px the rows become cards that say
// the same in words. "Show as table" swaps in the bookings table.
//
// Live: useLiveAvailability for today lives here, so its socket exists only while this
// tab is shown. Its snapshot decides which bookings exist (see day-timeline.ts); an
// interval it has that the fetch did not asks the page to refetch, at most once every 30 s.
//
// Keyboard: the chart is one tab stop (bars are not buttons, so the 44 px target rule
// holds). Up and Down move between spaces, Left and Right between a space's bookings,
// Home and End to its first and last. The focused booking's text appears beside it and
// in a polite live region; every value is also in the row's accessible name and the table.
// Where the chart scrolls inside its frame (tablets), each move scrolls the focused booking
// into view, and the text beside it is kept inside the frame's visible part.
import { type CSSProperties, type KeyboardEvent, type Ref, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import type { StaffBookingsResponse } from "../../shared/api.ts";
import { formatMinutes, isWeekday, siteClock } from "../../shared/time.ts";
import { COMPACT_QUERY, useMediaQuery } from "../hooks/useMediaQuery.ts";
import { useLiveAvailability } from "../live/useLiveAvailability.ts";
import { type SiteContext, timeRange } from "../pages/site.ts";
import { Button } from "../ui/Button.tsx";
import { DataTable } from "../ui/DataTable.tsx";
import { longDate } from "../ui/DateGrid.tsx";
import styles from "./timeline.module.css";
import { WrenchIcon } from "./icons.tsx";
import {
  type AxisSizes,
  type Bar,
  type OpenRequestRef,
  type TimelineRow,
  axisLayout,
  barText,
  buildRows,
  ended,
  headline,
  isOpen,
  labelFits,
  openRequestLink,
  place,
  rowSentence,
  summarize,
} from "./day-timeline.ts";

export const REFETCH_THROTTLE_MS = 30_000;
/** The track is at least one pixel per minute wide; wider screens only make bars wider. */
const PX_PER_MINUTE = 1;
/** Until the axis is measured: the "Now hh:mm" label's and an hour label's width in Chromium. */
const PILL_PX = 74;
const TICK_PX = 34;
/** Room kept between the text beside a booking and the frame's visible edges. */
const EDGE_PX = 4;

export interface DayTimelineProps {
  site: SiteContext;
  data: StaffBookingsResponse;
  /** A refetch is under way: the last render stays, dimmed. */
  refreshing?: boolean;
  openRequests: readonly OpenRequestRef[];
  /** Asks the page to fetch today's bookings again (this component throttles it). */
  onRefetch: () => void;
}

interface TableRow {
  key: string;
  space: string;
  bar: Bar;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function DayTimeline({ site, data, refreshing = false, openRequests, onRefetch }: DayTimelineProps) {
  const compact = useMediaQuery(COMPACT_QUERY);
  const weekend = !isWeekday(site.today);
  const live = useLiveAvailability(weekend ? null : site.siteId, weekend ? [] : [site.today]);
  const liveBusy = live.byDate[site.today]?.busy ?? null;
  const built = useMemo(() => buildRows(data.resources, data.bookings, liveBusy), [data, liveBusy]);
  const [asTable, setAsTable] = useState(false);
  const helpId = useId();

  // The site clock, moved once a minute; no request.
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const { openMin, closeMin } = site.rules;
  const clock = siteClock(site.rules.timezone, nowMs);
  const isToday = clock.date === site.today;
  // A page left open past midnight reads as after closing, never as a time on the new day.
  const nowMin = isToday ? clock.minutes : clock.date < site.today ? 0 : 24 * 60;
  const nowForBars = isToday ? clock.minutes : null;
  const showNow = isToday && isOpen(clock.minutes, openMin, closeMin);

  // A live booking the fetch has not named yet: refetch, at most once every 30 s.
  const lastRefetch = useRef(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchRef = useRef(onRefetch);
  refetchRef.current = onRefetch;
  useEffect(() => {
    if (built.unnamed === 0 || pending.current) return;
    const wait = Math.max(0, lastRefetch.current + REFETCH_THROTTLE_MS - Date.now());
    pending.current = setTimeout(() => {
      pending.current = null;
      lastRefetch.current = Date.now();
      refetchRef.current();
    }, wait);
  }, [built]);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  const rows = built.rows;
  const requestsFor = (spaceId: string) => openRequests.filter((q) => q.resourceId === spaceId);
  const total = rows.reduce((n, r) => n + r.bars.length, 0);

  if (weekend) return <p className={styles.muted}>The site is closed today.</p>;
  if (total === 0) return <p className={styles.muted}>No bookings today; every space is free.</p>;

  const tableRows: TableRow[] = rows
    .flatMap((r) => r.bars.map((bar) => ({ key: bar.key, space: r.space.name, bar })))
    .sort((a, b) => a.bar.startMin - b.bar.startMin || a.space.localeCompare(b.space));

  return (
    <div className={`${styles.timeline} ${refreshing ? styles.refreshing : ""}`} aria-busy={refreshing || undefined}>
      <div className={styles.toolbar}>
        <p className={styles.headline}>{headline(rows, nowMin, openMin, closeMin)}</p>
        <Button variant="secondary" aria-pressed={asTable} onClick={() => setAsTable((t) => !t)}>
          Show as table
        </Button>
      </div>
      {asTable ? (
        <DataTable
          caption={`Bookings today, ${site.today}`}
          columns={[
            { key: "time", header: "Time", render: (t: TableRow) => timeRange(t.bar.startMin, t.bar.endMin) },
            { key: "space", header: "Space", render: (t: TableRow) => t.space },
            { key: "who", header: "Booked by", render: (t: TableRow) => t.bar.booking?.employeeName ?? "Not loaded yet" },
            {
              key: "details",
              header: "Details",
              render: (t: TableRow) => {
                const b = t.bar.booking;
                const base = !b ? "Booked" : b.kind === "room" ? `${b.attendees} attending${b.title ? `, ${b.title}` : ""}` : "Desk";
                return ended(t.bar, nowForBars) ? `${base}, ended` : base;
              },
            },
          ]}
          rows={tableRows}
          rowKey={(t) => t.key}
          empty="No bookings today."
        />
      ) : compact ? (
        <ul className={styles.cards} aria-label={`Spaces today, ${longDate(site.today)}`}>
          {rows.map((row) => {
            const reqs = requestsFor(row.space.id);
            const summary = summarize(row, nowMin, openMin, closeMin);
            return (
              <li key={row.space.id} className={styles.card}>
                <span>
                  <strong>
                    {row.space.name}
                    {row.space.active ? "" : " (inactive)"}
                  </strong>
                  : {summary}
                </span>
                <span className={styles.muted}>{row.bars.length ? plural(row.bars.length, "booking") + " today" : "No bookings today"}</span>
                <RequestFlag requests={reqs} />
              </li>
            );
          })}
        </ul>
      ) : (
        <Chart site={site} rows={rows} nowMin={nowMin} nowForBars={nowForBars} showNow={showNow} clockMinutes={clock.minutes} requestsFor={requestsFor} helpId={helpId} />
      )}
    </div>
  );
}

function RequestFlag({ requests }: { requests: readonly OpenRequestRef[] }) {
  const to = openRequestLink(requests);
  if (!to) return null;
  return (
    <Link to={to} state={requests.length === 1 ? { from: "/staff?tab=today" } : undefined} className={styles.flag}>
      <WrenchIcon />
      {plural(requests.length, "open request")}
    </Link>
  );
}

interface ChartProps {
  site: SiteContext;
  rows: readonly TimelineRow[];
  nowMin: number;
  nowForBars: number | null;
  showNow: boolean;
  clockMinutes: number;
  requestsFor: (spaceId: string) => OpenRequestRef[];
  helpId: string;
}

function Chart({ site, rows, nowMin, nowForBars, showNow, clockMinutes, requestsFor, helpId }: ChartProps) {
  const { openMin, closeMin } = site.rules;
  const hours = (closeMin - openMin) / 60;
  const [focus, setFocus] = useState<{ r: number; b: number } | null>(null);
  const [focused, setFocused] = useState(false);
  const [hover, setHover] = useState<{ r: number; b: number } | null>(null);
  const [said, setSaid] = useState("");
  const frameRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLSpanElement>(null);
  const axisRef = useRef<HTMLSpanElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  // Set by a keyboard move: the next layout scrolls the focused booking into view.
  const reveal = useRef(false);
  const [sizes, setSizes] = useState<AxisSizes>(() => ({ track: (closeMin - openMin) * PX_PER_MINUTE, pill: PILL_PX, tick: TICK_PX }));

  // Keep the roving position inside the rows when they change.
  const clamp = (p: { r: number; b: number } | null) => {
    if (!p || rows.length === 0) return null;
    const r = Math.min(p.r, rows.length - 1);
    const n = (rows[r] as TimelineRow).bars.length;
    return { r, b: n === 0 ? -1 : Math.max(0, Math.min(p.b, n - 1)) };
  };
  const at = clamp(focus);
  const textAt = (p: { r: number; b: number }) => {
    const row = rows[p.r] as TimelineRow;
    const bar = row.bars[p.b];
    return bar ? barText(row.space, bar, nowForBars) : `${row.space.name}: no bookings today`;
  };
  const go = (p: { r: number; b: number } | null) => {
    const next = clamp(p);
    setFocus(next);
    if (next) {
      setSaid(textAt(next));
      reveal.current = true;
    }
  };
  /** The booking in another row nearest in time to the one focused now. */
  const nearest = (r: number, from: { r: number; b: number } | null) => {
    const row = rows[r];
    if (!row || row.bars.length === 0) return -1;
    const t = from ? (rows[from.r]?.bars[from.b]?.startMin ?? nowMin) : nowMin;
    let best = 0;
    row.bars.forEach((bar, i) => {
      if (Math.abs(bar.startMin - t) < Math.abs((row.bars[best] as Bar).startMin - t)) best = i;
    });
    return best;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = at ?? { r: 0, b: nearest(0, null) };
    const moves: Record<string, () => { r: number; b: number }> = {
      ArrowDown: () => ({ r: Math.min(rows.length - 1, cur.r + 1), b: nearest(Math.min(rows.length - 1, cur.r + 1), cur) }),
      ArrowUp: () => ({ r: Math.max(0, cur.r - 1), b: nearest(Math.max(0, cur.r - 1), cur) }),
      ArrowRight: () => ({ r: cur.r, b: cur.b + 1 }),
      ArrowLeft: () => ({ r: cur.r, b: Math.max(0, cur.b - 1) }),
      Home: () => ({ r: cur.r, b: 0 }),
      End: () => ({ r: cur.r, b: (rows[cur.r]?.bars.length ?? 1) - 1 }),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    go(move());
  };

  // The axis in pixels: measured once laid out and again whenever its width changes.
  useLayoutEffect(() => {
    const axis = axisRef.current;
    if (!axis) return;
    const measure = () => {
      const track = axis.getBoundingClientRect().width;
      if (track <= 0) return; // not laid out (jsdom): keep the estimates
      const pill = pillRef.current?.getBoundingClientRect().width || 0;
      const tick = axis.querySelector<HTMLElement>("[data-tick]")?.getBoundingClientRect().width || 0;
      setSizes((s) => {
        const next = { track, pill: pill || s.pill, tick: tick || s.tick };
        return next.track === s.track && next.pill === s.pill && next.tick === s.tick ? s : next;
      });
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(axis);
    if (pillRef.current) observer.observe(pillRef.current);
    return () => observer.disconnect();
  }, [showNow]);

  // After every render: a keyboard move scrolls its booking into view, then the text
  // beside the focused or hovered booking is kept inside the frame's visible part.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const inset = nameRef.current?.offsetWidth ?? 0;
    if (reveal.current) {
      reveal.current = false;
      const el = frame.querySelector<HTMLElement>("[data-focused]");
      el?.closest("li")?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
      if (el?.dataset.focused === "bar") revealInFrame(frame, el, inset);
    }
    fitInFrame(frame, tipRef.current, inset);
  });

  const tip = hover ?? (focused ? at : null);
  const style = { "--hours": hours, "--track-min": `${(closeMin - openMin) * PX_PER_MINUTE}px` } as CSSProperties;
  const nowLeft = place(clockMinutes, clockMinutes, openMin, closeMin).left;
  // Hour labels every 2 hours, minus any the Now label would touch; the label stays inside the axis.
  const axis = axisLayout(openMin, closeMin, showNow ? clockMinutes : null, sizes);

  return (
    <>
      {/* Two bar colors carry meaning, so a legend names them in words. The same words are
          in each row's accessible name, the tooltip and the table ("ended"). */}
      <p className={styles.legend} data-testid="timeline-legend">
        <span className={styles.legendItem}>
          <span className={styles.swatch} aria-hidden="true" />
          Booked
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles.ended}`} aria-hidden="true" />
          Ended before now
        </span>
      </p>
      <div className={styles.scroll} ref={frameRef} data-testid="timeline-frame" onScroll={() => fitInFrame(frameRef.current, tipRef.current, nameRef.current?.offsetWidth ?? 0)}>
        <div
          role="group"
          tabIndex={0}
          aria-label={`Bookings by space, ${longDate(site.today)}`}
          aria-describedby={helpId}
          className={styles.chart}
          style={style}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
            if (!at) go({ r: 0, b: nearest(0, null) });
            else reveal.current = true;
          }}
          onBlur={() => setFocused(false)}
        >
          <div className={styles.axis} aria-hidden="true">
            <span className={styles.nameCell} ref={nameRef}>
              Space
            </span>
            <span className={styles.axisTrack} ref={axisRef}>
              {axis.ticks.map((m) => (
                <span key={m} className={styles.tick} style={{ left: `${place(m, m, openMin, closeMin).left}%` }} data-tick>
                  {formatMinutes(m)}
                </span>
              ))}
              {showNow && axis.pillLeft !== null ? (
                <span className={styles.nowLabel} style={{ left: `${axis.pillLeft}px` }} ref={pillRef} data-testid="now-label">
                  Now {formatMinutes(clockMinutes)}
                </span>
              ) : null}
            </span>
          </div>
          <ul className={styles.rows}>
            {rows.map((row, r) => {
              const reqs = requestsFor(row.space.id);
              const sentence = rowSentence(row, nowForBars, summarize(row, nowMin, openMin, closeMin), reqs.length);
              const rowFocused = focused && at?.r === r && at.b === -1;
              return (
                <li key={row.space.id} className={styles.row} aria-label={sentence}>
                  <span className={`${styles.nameCell} ${rowFocused ? styles.rowFocus : ""}`} data-focused={rowFocused ? "row" : undefined}>
                    <span aria-hidden="true" className={styles.name}>
                      {row.space.name}
                      {row.space.active ? "" : " (inactive)"}
                    </span>
                    <RequestFlag requests={reqs} />
                  </span>
                  <span className={styles.track} aria-hidden="true" data-testid={`track-${row.space.id}`}>
                    {row.bars.map((bar, b) => {
                      const { left, width } = place(bar.startMin, bar.endMin, openMin, closeMin);
                      const over = ended(bar, nowForBars);
                      const label = bar.booking?.employeeName ?? "Booked";
                      const isFocus = focused && at?.r === r && at.b === b;
                      return (
                        <span
                          key={bar.key}
                          className={`${styles.bar} ${over ? styles.ended : ""} ${isFocus ? styles.barFocus : ""}`}
                          style={{ left: `calc(${left}% + 1px)`, width: `calc(${width}% - 2px)` }}
                          data-start={bar.startMin}
                          data-end={bar.endMin}
                          data-ended={over || undefined}
                          data-focused={isFocus ? "bar" : undefined}
                          onPointerEnter={() => setHover({ r, b })}
                          onPointerLeave={() => setHover(null)}
                        >
                          {!over && labelFits(label, bar.endMin - bar.startMin, PX_PER_MINUTE) ? <span className={styles.barLabel}>{label}</span> : null}
                        </span>
                      );
                    })}
                    {tip && tip.r === r && row.bars[tip.b] ? (
                      <Tooltip ref={tipRef} text={textAt(tip)} span={place((row.bars[tip.b] as Bar).startMin, (row.bars[tip.b] as Bar).endMin, openMin, closeMin)} below={r === 0} />
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          {showNow ? <span className={styles.nowRule} style={{ "--now": nowLeft / 100 } as CSSProperties} aria-hidden="true" data-testid="now-rule" /> : null}
        </div>
        <p id={helpId} className={styles.help}>
          Up and Down move between spaces, Left and Right between bookings, Home and End to the first and last.
        </p>
        <div className="visually-hidden" aria-live="polite">
          {focused ? said : ""}
        </div>
      </div>
    </>
  );
}

/** The frame's visible part right of the sticky space names, in viewport px; null before layout. */
function visibleBox(frame: HTMLElement, inset: number): { left: number; right: number } | null {
  const box = frame.getBoundingClientRect();
  if (box.width <= 0) return null;
  const left = box.left + frame.clientLeft;
  return { left: left + inset, right: left + frame.clientWidth };
}

/** Scrolls the frame sideways so a bar shows right of the space names: its end if it fits, its start always. */
function revealInFrame(frame: HTMLElement, el: HTMLElement, inset: number): void {
  const box = visibleBox(frame, inset);
  if (!box) return;
  const r = el.getBoundingClientRect();
  let dx = 0;
  if (r.right > box.right - EDGE_PX) dx = r.right - (box.right - EDGE_PX);
  if (r.left - dx < box.left + EDGE_PX) dx = r.left - (box.left + EDGE_PX);
  if (dx !== 0) frame.scrollLeft += dx;
}

/** Shifts the text beside a booking sideways so it stays inside the frame's visible part. */
function fitInFrame(frame: HTMLElement | null, tip: HTMLElement | null, inset: number): void {
  if (!frame || !tip) return;
  tip.style.transform = "";
  const box = visibleBox(frame, inset);
  if (!box) return;
  tip.style.maxWidth = `min(22rem, ${Math.max(0, box.right - box.left - 2 * EDGE_PX)}px)`;
  const r = tip.getBoundingClientRect();
  let dx = 0;
  if (r.right > box.right - EDGE_PX) dx = box.right - EDGE_PX - r.right;
  if (r.left + dx < box.left + EDGE_PX) dx = box.left + EDGE_PX - r.left;
  if (dx !== 0) tip.style.transform = `translateX(${dx}px)`;
}

interface TooltipProps {
  text: string;
  span: { left: number; width: number };
  below: boolean;
  ref: Ref<HTMLSpanElement>;
}

function Tooltip({ text, span, below, ref }: TooltipProps) {
  // Late in the day the text hangs left from the bar's end; fitInFrame then keeps it
  // inside the part of the chart that shows.
  const anchorRight = span.left > 55;
  return (
    <span
      ref={ref}
      className={`${styles.tooltip} ${below ? styles.tooltipBelow : ""}`}
      style={anchorRight ? { right: `${100 - span.left - span.width}%` } : { left: `${span.left}%` }}
      data-testid="timeline-tooltip"
    >
      {text}
    </span>
  );
}
