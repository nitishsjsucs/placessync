// "Bookings per day" (VIZ-07): two small-multiple column charts, desks and rooms, on one
// weekday axis and one shared y scale, so the facilities admin can see whether demand is
// changing and how much is already booked ahead. Weekends are left out (the site is
// closed); a missing weekday is a zero column. Columns before today are --color-primary;
// from today on they are --color-border-strong under a "Today, booked so far" label,
// because those days are not over.
//
// Each chart is one tab stop (role="img" with a summary sentence): Left, Right, Home and
// End move a focused column whose numbers show beside it and in a polite live region;
// a pointer snaps to the nearest column. "Show table" reveals the same numbers.
import { type KeyboardEvent, type PointerEvent, useId, useRef, useState } from "react";
import type { UtilizationReport } from "../../shared/api.ts";
import { dayOfWeek } from "../../shared/time.ts";
import { Button } from "../ui/Button.tsx";
import { DataTable } from "../ui/DataTable.tsx";
import styles from "./columns.module.css";
import chartStyles from "./charts.module.css";
import { type DayColumn, type Kind, dailyColumns } from "./held-ahead.ts";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parts(date: string) {
  const [, m, d] = date.split("-").map(Number) as [number, number, number];
  return { m, d };
}
/** "October 20". */
export function monthDay(date: string): string {
  const { m, d } = parts(date);
  return `${MONTHS[m - 1]} ${d}`;
}
/** "Oct 20": the axis label under each Monday. */
function shortDay(date: string): string {
  const { m, d } = parts(date);
  return `${SHORT[m - 1]} ${d}`;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "Tuesday, October 20: 31 desk bookings, 2 cancelled" ("so far" from today on). */
export function columnText(c: DayColumn, kind: Kind): string {
  return `${WEEKDAYS[dayOfWeek(c.date)]}, ${monthDay(c.date)}: ${plural(c.confirmed, `${kind} booking`)}${c.ahead ? " so far" : ""}, ${c.cancelled} cancelled`;
}

/** The chart's role="img" sentence. */
export function columnsSummary(columns: readonly DayColumn[], kind: Kind, range: { from: string; to: string }, today: string): string {
  const head = `${kind === "desk" ? "Desk" : "Room"} bookings per weekday, ${monthDay(range.from)} to ${monthDay(range.to)}`;
  const top = columns.reduce<DayColumn | null>((best, c) => (c.confirmed > (best?.confirmed ?? 0) ? c : best), null);
  const highest = top ? `highest ${top.confirmed} on ${monthDay(top.date)}` : "none in this range";
  const todayPart = today >= range.from && today <= range.to ? `; today is ${monthDay(today)}` : "";
  return `${head}; ${highest}${todayPart}`;
}

export interface DailyColumnsProps {
  report: UtilizationReport;
  range: { from: string; to: string };
  today: string;
  refreshing?: boolean;
}

type DailyRow = UtilizationReport["daily"][number];

export function DailyColumns({ report, range, today, refreshing = false }: DailyColumnsProps) {
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();
  const headingId = useId();
  const desks = dailyColumns(report, "desk", range, today);
  const rooms = dailyColumns(report, "room", range, today);
  // One y scale for both, so a room column and a desk column of the same height mean the same.
  const max = Math.max(1, ...desks.map((c) => c.confirmed), ...rooms.map((c) => c.confirmed));
  const any = report.daily.some((d) => d.date >= range.from && d.date <= range.to && d.confirmed + d.cancelled > 0);

  return (
    <section className={`${chartStyles.section} ${refreshing ? chartStyles.refreshing : ""}`} aria-labelledby={headingId} aria-busy={refreshing || undefined}>
      <div className={chartStyles.sectionHead}>
        <h2 id={headingId}>Bookings per day</h2>
        <Button variant="secondary" size="sm" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((s) => !s)}>
          Show table<span className="visually-hidden">: bookings per day</span>
        </Button>
      </div>
      {any ? (
        <div className={styles.multiples}>
          <Columns kind="desk" title="Desks" columns={desks} max={max} range={range} today={today} />
          <Columns kind="room" title="Rooms" columns={rooms} max={max} range={range} today={today} />
        </div>
      ) : (
        <p className={chartStyles.muted}>No bookings in this range yet.</p>
      )}
      <div id={tableId} hidden={!showTable}>
        {showTable ? (
          <DataTable
            caption="Bookings per day"
            columns={[
              { key: "date", header: "Date", render: (r: DailyRow) => <span className={styles.nowrap}>{r.date}</span> },
              { key: "kind", header: "Kind", render: (r: DailyRow) => (r.resourceKind === "desk" ? "Desks" : "Rooms") },
              { key: "confirmed", header: "Confirmed", render: (r: DailyRow) => r.confirmed },
              { key: "cancelled", header: "Cancelled", render: (r: DailyRow) => r.cancelled },
            ]}
            rows={report.daily}
            rowKey={(r) => `${r.date}-${r.resourceKind}`}
            empty="No bookings in this range yet."
            stacked={false}
          />
        ) : null}
      </div>
    </section>
  );
}

interface ColumnsProps {
  kind: Kind;
  title: string;
  columns: readonly DayColumn[];
  max: number;
  range: { from: string; to: string };
  today: string;
}

function Columns({ kind, title, columns, max, range, today }: ColumnsProps) {
  const [focus, setFocus] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [focused, setFocused] = useState(false);
  const slots = useRef<(HTMLSpanElement | null)[]>([]);
  const helpId = useId();
  const held = columns.filter((c) => !c.ahead);
  const ahead = columns.filter((c) => c.ahead);
  const shown = hover ?? (focused ? focus : null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const last = columns.length - 1;
    const cur = focus ?? 0;
    const next = { ArrowRight: Math.min(last, cur + 1), ArrowLeft: Math.max(0, cur - 1), Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    setFocus(next);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    let best: number | null = null;
    let dist = Number.POSITIVE_INFINITY;
    slots.current.forEach((el, i) => {
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - e.clientX);
      if (d < dist) {
        dist = d;
        best = i;
      }
    });
    setHover(best);
  };

  const slot = (c: DayColumn) => {
    const i = columns.indexOf(c);
    const monday = dayOfWeek(c.date) === 1;
    // Keep labels and the tooltip inside the chart near its edges.
    const at = columns.length > 1 ? i / (columns.length - 1) : 0.5;
    const tipSide = at < 0.35 ? styles.tipStart : at > 0.65 ? styles.tipEnd : "";
    return (
      <span
        key={c.date}
        className={`${styles.slot} ${i === shown ? styles.active : ""}`}
        ref={(el) => {
          slots.current[i] = el;
        }}
        data-date={c.date}
      >
        <span className={styles.area}>
          {c.confirmed > 0 ? <span className={`${styles.column} ${c.ahead ? styles.ahead : ""}`} style={{ height: `${(c.confirmed / max) * 100}%` }} /> : null}
          {i === shown ? <span className={`${styles.tip} ${tipSide}`}>{columnText(c, kind)}</span> : null}
        </span>
        <span className={`${styles.tick} ${monday ? styles.monday : ""} ${i >= columns.length - 4 ? styles.tickEnd : ""}`}>{monday ? <span>{shortDay(c.date)}</span> : null}</span>
      </span>
    );
  };

  return (
    <figure className={styles.figure}>
      <figcaption className={styles.caption}>{title}</figcaption>
      <div className={styles.frame}>
        <div className={styles.yAxis} aria-hidden="true">
          <span>{max}</span>
          <span>0</span>
        </div>
        <div
          className={styles.plot}
          role="img"
          tabIndex={0}
          aria-label={columnsSummary(columns, kind, range, today)}
          aria-describedby={helpId}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setFocused(true);
            if (focus === null) setFocus(Math.max(0, held.length - 1));
          }}
          onBlur={() => setFocused(false)}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setHover(null)}
          data-testid={`columns-${kind}`}
        >
          {held.length ? (
            <span className={styles.group} style={{ flexGrow: held.length }}>
              {held.map(slot)}
            </span>
          ) : null}
          {ahead.length ? (
            <span className={`${styles.group} ${held.length ? styles.today : ""}`} style={{ flexGrow: ahead.length }}>
              <span className={`${styles.region} ${ahead.length <= 3 ? styles.regionEnd : ""}`}>{held.length ? "Today, booked so far" : "Booked so far"}</span>
              {ahead.map(slot)}
            </span>
          ) : null}
        </div>
      </div>
      <p id={helpId} className="visually-hidden">
        Left and Right move between days; Home and End go to the first and last.
      </p>
      <div className="visually-hidden" aria-live="polite">
        {focused && focus !== null && columns[focus] ? columnText(columns[focus] as DayColumn, kind) : ""}
      </div>
    </figure>
  );
}
