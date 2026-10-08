// SlotGrid (SPEC 14.2): rows (resources or days) by time slots as role="grid".
// Arrows move, Shift+Arrow extends a range within a row, Enter commits onSelect(range),
// Escape clears. Busy cells are aria-disabled and never selectable. When a live update
// makes the selected range busy, the selection clears and a polite announcement is
// made. Under 640 px it renders a single-resource chip list instead (useMediaQuery).
import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { COMPACT_QUERY, useMediaQuery } from "../hooks/useMediaQuery.ts";
import { formatMinutes } from "../../shared/time.ts";
import styles from "./SlotGrid.module.css";

export interface SlotBusy {
  startMin: number;
  endMin: number;
  mine?: boolean;
}

export interface SlotRow {
  id: string;
  label: string;
  busy: readonly SlotBusy[];
}

export interface SlotSelection {
  rowId: string;
  startMin: number;
  endMin: number;
}

export interface SlotGridProps {
  label: string;
  rows: readonly SlotRow[];
  openMin: number;
  closeMin: number;
  slotMinutes?: number;
  selection: SlotSelection | null;
  onSelect: (selection: SlotSelection | null) => void;
  /** Heading of the row-header column, such as "Resource" or "Day". */
  rowHeader?: string;
  /** Slots before this minute are not selectable (today's past slots), per row id. */
  minStartFor?: (rowId: string) => number;
}

type CellState = "free" | "busy" | "mine";

function stateOf(row: SlotRow, start: number, end: number): CellState {
  for (const b of row.busy) if (b.startMin < end && start < b.endMin) return b.mine ? "mine" : "busy";
  return "free";
}

function overlapsBusy(row: SlotRow | undefined, sel: SlotSelection): boolean {
  return !!row && row.busy.some((b) => b.startMin < sel.endMin && sel.startMin < b.endMin);
}

export function SlotGrid(props: SlotGridProps) {
  const compact = useMediaQuery(COMPACT_QUERY);
  const { rows, selection, onSelect } = props;
  const [announcement, setAnnouncement] = useState("");

  // A live update that makes the selected range busy clears it, politely.
  useEffect(() => {
    if (!selection) return;
    const row = rows.find((r) => r.id === selection.rowId);
    if (!row || !overlapsBusy(row, selection)) return;
    onSelect(null);
    // The viewer's own booking arriving live is not news; someone else's is.
    const othersBooked = row.busy.some((b) => !b.mine && b.startMin < selection.endMin && selection.startMin < b.endMin);
    if (othersBooked) {
      setAnnouncement(`${formatMinutes(selection.startMin)} to ${formatMinutes(selection.endMin)} on ${row.label} was just booked by someone else. Pick another time.`);
    }
  }, [rows, selection, onSelect]);

  return (
    <div>
      {compact ? <CompactSlots {...props} /> : <GridSlots {...props} />}
      <div className="visually-hidden" aria-live="polite" data-testid="slotgrid-live">
        {announcement}
      </div>
    </div>
  );
}

function GridSlots({ label, rows, openMin, closeMin, slotMinutes = 30, selection, onSelect, rowHeader = "Resource", minStartFor }: SlotGridProps) {
  const base = useId();
  const slots = useMemo(() => {
    const out: number[] = [];
    for (let m = openMin; m < closeMin; m += slotMinutes) out.push(m);
    return out;
  }, [openMin, closeMin, slotMinutes]);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const shouldFocus = useRef(false);

  useEffect(() => {
    if (shouldFocus.current) {
      cellRefs.current.get(`${focus.r}:${focus.c}`)?.focus();
      shouldFocus.current = false;
    }
  }, [focus]);

  // Keep the roving focus inside the grid when rows change.
  useEffect(() => {
    if (focus.r >= rows.length && rows.length > 0) setFocus({ r: rows.length - 1, c: focus.c });
  }, [rows.length, focus]);

  const startOf = (c: number) => slots[c] as number;
  const minStart = (rowId: string) => minStartFor?.(rowId) ?? -1;
  const blocked = (r: number, c: number) => {
    const row = rows[r];
    if (!row) return true;
    return stateOf(row, startOf(c), startOf(c) + slotMinutes) !== "free" || startOf(c) < minStart(row.id);
  };

  /** The range from the anchor to the focused cell, if it is entirely free and in one row. */
  const pendingRange = (): SlotSelection | null => {
    const row = rows[focus.r];
    if (!row) return null;
    const a = anchor && anchor.r === focus.r ? anchor.c : focus.c;
    const lo = Math.min(a, focus.c);
    const hi = Math.max(a, focus.c);
    for (let c = lo; c <= hi; c++) if (blocked(focus.r, c)) return null;
    return { rowId: row.id, startMin: startOf(lo), endMin: startOf(hi) + slotMinutes };
  };

  const move = (r: number, c: number, extend: boolean) => {
    const nr = Math.max(0, Math.min(rows.length - 1, r));
    const nc = Math.max(0, Math.min(slots.length - 1, c));
    if (extend) {
      // Shift+Arrow extends within the row and never across a busy cell.
      if (nr !== focus.r || blocked(nr, nc)) return;
      if (!anchor || anchor.r !== focus.r) setAnchor({ r: focus.r, c: focus.c });
    } else {
      setAnchor(null);
    }
    shouldFocus.current = true;
    setFocus({ r: nr, c: nc });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTableCellElement>) => {
    const { r, c } = focus;
    switch (e.key) {
      case "ArrowRight":
        e.preventDefault();
        move(r, c + 1, e.shiftKey);
        break;
      case "ArrowLeft":
        e.preventDefault();
        move(r, c - 1, e.shiftKey);
        break;
      case "ArrowDown":
        e.preventDefault();
        if (!e.shiftKey) move(r + 1, c, false);
        break;
      case "ArrowUp":
        e.preventDefault();
        if (!e.shiftKey) move(r - 1, c, false);
        break;
      case "Home":
        e.preventDefault();
        move(r, 0, false);
        break;
      case "End":
        e.preventDefault();
        move(r, slots.length - 1, false);
        break;
      case "Enter":
      case " ": {
        e.preventDefault();
        const range = pendingRange();
        if (range) onSelect(range);
        break;
      }
      case "Escape":
        e.preventDefault();
        setAnchor(null);
        onSelect(null);
        break;
    }
  };

  const range = pendingRange();
  const inPending = (r: number, c: number) =>
    !!anchor && !!range && anchor.r === r && rows[r]?.id === range.rowId && startOf(c) >= range.startMin && startOf(c) < range.endMin;
  const inSelection = (r: number, c: number) =>
    !!selection && rows[r]?.id === selection.rowId && startOf(c) >= selection.startMin && startOf(c) < selection.endMin;

  return (
    <div className={styles.wrap}>
      <table role="grid" aria-label={label} aria-describedby={`${base}-help`} className={styles.grid}>
        <thead>
          <tr>
            <th scope="col" className={styles.corner}>
              {rowHeader}
            </th>
            {slots.map((m) => (
              <th key={m} scope="col" className={styles.timeHeader}>
                {m % 60 === 0 ? formatMinutes(m) : <span className="visually-hidden">{formatMinutes(m)}</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.id}>
              <th scope="row" className={styles.rowHeader}>
                {row.label}
              </th>
              {slots.map((m, c) => {
                const state = stateOf(row, m, m + slotMinutes);
                const past = m < minStart(row.id);
                const selected = inSelection(r, c) || inPending(r, c);
                const words = state === "mine" ? "your booking" : state === "busy" ? "booked" : past ? "past" : "available";
                const classes = [styles.cell, state === "busy" ? styles.busy : "", state === "mine" ? styles.mine : "", past ? styles.busy : "", selected ? styles.selected : ""].join(" ");
                return (
                  <td
                    key={m}
                    ref={(el) => {
                      if (el) cellRefs.current.set(`${r}:${c}`, el);
                      else cellRefs.current.delete(`${r}:${c}`);
                    }}
                    role="gridcell"
                    className={classes}
                    tabIndex={focus.r === r && focus.c === c ? 0 : -1}
                    aria-selected={selected}
                    aria-disabled={state !== "free" || past ? true : undefined}
                    aria-label={`${row.label}, ${formatMinutes(m)} to ${formatMinutes(m + slotMinutes)}, ${words}`}
                    data-row={row.id}
                    data-start={m}
                    onKeyDown={onKeyDown}
                    onClick={(e) => {
                      setFocus({ r, c });
                      if (state !== "free" || past) return;
                      if (e.shiftKey && selection && selection.rowId === row.id) {
                        const lo = Math.min(selection.startMin, m);
                        const hi = Math.max(selection.endMin, m + slotMinutes);
                        const candidate = { rowId: row.id, startMin: lo, endMin: hi };
                        if (!overlapsBusy(row, candidate)) onSelect(candidate);
                      } else {
                        setAnchor(null);
                        onSelect({ rowId: row.id, startMin: m, endMin: m + slotMinutes });
                      }
                    }}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p id={`${base}-help`} className={styles.legend}>
        <span>Arrow keys move. Shift with Left or Right extends the time. Enter selects. Escape clears.</span>
        <span>
          <span className={`${styles.swatch} ${styles.busy}`} aria-hidden="true" />
          Booked
        </span>
        <span>
          <span className={`${styles.swatch} ${styles.mine}`} aria-hidden="true" />
          Yours
        </span>
        <span>
          <span className={`${styles.swatch} ${styles.selected}`} aria-hidden="true" />
          Selected
        </span>
      </p>
    </div>
  );
}

function CompactSlots({ label, rows, openMin, closeMin, slotMinutes = 30, selection, onSelect, rowHeader = "Resource", minStartFor }: SlotGridProps) {
  const base = useId();
  const [rowId, setRowId] = useState<string>(selection?.rowId ?? rows[0]?.id ?? "");
  const row = rows.find((r) => r.id === rowId) ?? rows[0];
  // Follow a selection made elsewhere, but let the viewer browse other rows freely.
  const selectedRow = selection?.rowId;
  useEffect(() => {
    if (selectedRow) setRowId(selectedRow);
  }, [selectedRow]);
  if (!row) return <p>No {rowHeader.toLowerCase()}s match.</p>;
  const slots: number[] = [];
  for (let m = openMin; m < closeMin; m += slotMinutes) slots.push(m);
  const minStart = minStartFor?.(row.id) ?? -1;

  const pick = (m: number) => {
    const single = { rowId: row.id, startMin: m, endMin: m + slotMinutes };
    if (selection && selection.rowId === row.id && m >= selection.endMin) {
      const extended = { rowId: row.id, startMin: selection.startMin, endMin: m + slotMinutes };
      onSelect(overlapsBusy(row, extended) ? single : extended);
    } else {
      onSelect(single);
    }
  };

  return (
    <div className={styles.compact} data-testid="slotgrid-compact">
      <label className={styles.compactLabel} htmlFor={`${base}-row`}>
        {rowHeader}
        <select id={`${base}-row`} className={styles.select} value={row.id} onChange={(e) => setRowId(e.target.value)}>
          {rows.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
      </label>
      <ul className={styles.chips} aria-label={`${label}: ${row.label}`}>
        {slots.map((m) => {
          const state = stateOf(row, m, m + slotMinutes);
          const selected = !!selection && selection.rowId === row.id && m >= selection.startMin && m < selection.endMin;
          return (
            <li key={m}>
              <button
                type="button"
                className={styles.chip}
                disabled={state !== "free" || m < minStart}
                aria-pressed={selected}
                aria-label={`${formatMinutes(m)} to ${formatMinutes(m + slotMinutes)}${state === "mine" ? ", your booking" : state === "busy" ? ", booked" : ""}`}
                onClick={() => pick(m)}
              >
                {formatMinutes(m)}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
