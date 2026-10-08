// DateGrid (SPEC 14.2): a month calendar as role="grid" with a roving tabindex.
// Arrows move by day and week, PageUp and PageDown by month, Home and End to the week
// bounds, Enter and Space select. Disabled dates stay focusable, are not selectable,
// and explain why through aria-describedby. Seven columns fit 320 px.
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { addDays, dayOfWeek } from "../../shared/time.ts";
import styles from "./DateGrid.module.css";

export interface DateGridProps {
  label: string;
  value: string | null;
  onChange: (date: string) => void;
  /** Returns a reason when the date cannot be picked. */
  isDisabled?: (date: string) => string | null;
  today?: string;
  /** Month shown first when nothing is selected (YYYY-MM). */
  initialMonth?: string;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const monthOf = (date: string) => date.slice(0, 7);
const daysInMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
};
const mondayIndex = (date: string) => (dayOfWeek(date) + 6) % 7;

function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const month = `${ny}-${String(nm).padStart(2, "0")}`;
  return `${month}-${String(Math.min(d, daysInMonth(month))).padStart(2, "0")}`;
}

export function longDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return `${WEEKDAY_NAMES[mondayIndex(date)]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

export function DateGrid({ label, value, onChange, isDisabled = () => null, today, initialMonth }: DateGridProps) {
  const base = useId();
  const [focusDate, setFocusDate] = useState<string>(value ?? (initialMonth ? `${initialMonth}-01` : (today ?? new Date().toISOString().slice(0, 10))));
  const month = monthOf(focusDate);
  const cells = useRef(new Map<string, HTMLTableCellElement>());
  const shouldFocus = useRef(false);

  useEffect(() => {
    if (value) setFocusDate(value);
  }, [value]);

  useEffect(() => {
    if (shouldFocus.current) {
      cells.current.get(focusDate)?.focus();
      shouldFocus.current = false;
    }
  }, [focusDate]);

  const weeks = useMemo(() => {
    const first = `${month}-01`;
    const lead = mondayIndex(first);
    const days: (string | null)[] = [...Array.from({ length: lead }, () => null)];
    for (let i = 0; i < daysInMonth(month); i++) days.push(addDays(first, i));
    while (days.length % 7 !== 0) days.push(null);
    const out: (string | null)[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [month]);

  const reasons = new Map<string, string>();
  for (const week of weeks) for (const d of week) if (d) {
    const r = isDisabled(d);
    if (r) reasons.set(r, `${base}-reason-${reasons.size}`);
  }

  const moveTo = (date: string) => {
    shouldFocus.current = true;
    setFocusDate(date);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableCellElement>, date: string) => {
    const idx = mondayIndex(date);
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(date, -1),
      ArrowRight: () => addDays(date, 1),
      ArrowUp: () => addDays(date, -7),
      ArrowDown: () => addDays(date, 7),
      PageUp: () => addMonths(date, -1),
      PageDown: () => addMonths(date, 1),
      Home: () => addDays(date, -idx),
      End: () => addDays(date, 6 - idx),
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      moveTo(move());
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!isDisabled(date)) onChange(date);
    }
  };

  const [y, m] = month.split("-").map(Number) as [number, number];
  const headingId = `${base}-heading`;

  return (
    <div className={styles.wrap}>
      <div className={styles.header}>
        <button type="button" className={styles.navButton} aria-label="Previous month" onClick={() => setFocusDate(addMonths(focusDate, -1))}>
          <span aria-hidden="true">‹</span>
        </button>
        <h3 id={headingId} className={styles.month} aria-live="polite">
          {MONTHS[m - 1]} {y}
        </h3>
        <button type="button" className={styles.navButton} aria-label="Next month" onClick={() => setFocusDate(addMonths(focusDate, 1))}>
          <span aria-hidden="true">›</span>
        </button>
      </div>
      <table role="grid" className={styles.grid} aria-label={`${label}, ${MONTHS[m - 1]} ${y}`}>
        <thead>
          <tr>
            {WEEKDAYS.map((d, i) => (
              <th key={d} scope="col" abbr={WEEKDAY_NAMES[i]}>
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, wi) => (
            <tr key={wi}>
              {week.map((date, di) => {
                if (!date) return <td key={`e${di}`} role="gridcell" />;
                const reason = isDisabled(date);
                const classes = [styles.day, date === value ? styles.selected : "", reason ? styles.disabled : "", date === today ? styles.today : ""].join(" ");
                return (
                  <td
                    key={date}
                    ref={(el) => {
                      if (el) cells.current.set(date, el);
                      else cells.current.delete(date);
                    }}
                    role="gridcell"
                    className={classes}
                    tabIndex={date === focusDate ? 0 : -1}
                    aria-selected={date === value}
                    aria-disabled={reason ? true : undefined}
                    aria-describedby={reason ? reasons.get(reason) : undefined}
                    aria-label={longDate(date)}
                    aria-current={date === today ? "date" : undefined}
                    data-date={date}
                    onClick={() => {
                      setFocusDate(date);
                      if (!reason) onChange(date);
                    }}
                    onKeyDown={(e) => onKeyDown(e, date)}
                  >
                    {Number(date.slice(8))}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {[...reasons].map(([text, id]) => (
        <span key={id} id={id} className="visually-hidden">
          {text}
        </span>
      ))}
    </div>
  );
}
