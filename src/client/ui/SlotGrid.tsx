// SlotGrid (SPEC 14.2): rows (resources or days) by time slots as role="grid".
// Arrows move, Shift+Arrow extends a range within a row, Enter commits onSelect(range),
// Escape clears. Busy cells are aria-disabled and never selectable. When a live update
// makes the selected range busy, the selection clears and a polite announcement is
// made. Under 640 px it renders a single-resource chip list instead (useMediaQuery).
// Cells that cannot be booked for another reason (a past time, a closed or past day, a
// day beyond the horizon) are drawn plainly muted, not hatched like booked ones, and
// their names say why. When the grid first shows a date, it scrolls so the first
// selectable column (or the selection) sits next to the sticky row header.
// A plain click, a tap, or Enter without a Shift-extended range selects the shortest
// valid booking for that row (minSlotsFor, such as two cells for a 60-minute desk
// minimum) when those cells are free, else the one cell. An explicit range is never padded.
import { type KeyboardEvent, type Ref, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from "react";
import { COMPACT_QUERY, useMediaQuery } from "../hooks/useMediaQuery.ts";
import { formatMinutes } from "../../shared/time.ts";
import { Button } from "./Button.tsx";
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
  /** A word when a whole row cannot be booked ("past", "closed", "not open for booking yet"). */
  rowUnavailable?: (rowId: string) => string | null;
  /** Cells a first click selects in this row, the shortest valid booking (default 1). */
  minSlotsFor?: (rowId: string) => number;
  /** Called with the announcement when a live update clears the selection (someone else booked it). */
  onLiveClear?: (message: string) => void;
  ref?: Ref<SlotGridHandle>;
}

export interface SlotGridHandle {
  /** Moves focus into a row at a time (grid), or to the row's first open chip (compact). */
  focusRow: (rowId: string, startMin: number) => void;
}

type ModeProps = Omit<SlotGridProps, "ref"> & { handle: Ref<SlotGridHandle> };

type CellState = "free" | "busy" | "mine";

function stateOf(row: SlotRow, start: number, end: number): CellState {
  for (const b of row.busy) if (b.startMin < end && start < b.endMin) return b.mine ? "mine" : "busy";
  return "free";
}

function overlapsBusy(row: SlotRow | undefined, sel: SlotSelection): boolean {
  return !!row && row.busy.some((b) => b.startMin < sel.endMin && sel.startMin < b.endMin);
}

/**
 * The shortest valid selection starting at column c: n cells when all of them are
 * selectable and inside open hours, else the single cell.
 */
function paddedFrom(rowId: string, c: number, n: number, slots: readonly number[], slotMinutes: number, blocked: (c: number) => boolean): SlotSelection {
  const start = slots[c] as number;
  let last = c;
  if (n > 1 && c + n - 1 < slots.length) {
    let ok = true;
    for (let k = c + 1; k < c + n; k++) if (blocked(k)) ok = false;
    if (ok) last = c + n - 1;
  }
  return { rowId, startMin: start, endMin: (slots[last] as number) + slotMinutes };
}

export function SlotGrid({ ref, ...props }: SlotGridProps) {
  const compact = useMediaQuery(COMPACT_QUERY);
  const { rows, selection, onSelect, onLiveClear } = props;
  const [announcement, setAnnouncement] = useState("");
  const mode = useRef<SlotGridHandle>(null);
  useImperativeHandle(ref, () => ({ focusRow: (rowId, startMin) => mode.current?.focusRow(rowId, startMin) }), []);
  const liveClearRef = useRef(onLiveClear);
  liveClearRef.current = onLiveClear;

  // A live update that makes the selected range busy clears it, politely.
  useEffect(() => {
    if (!selection) return;
    const row = rows.find((r) => r.id === selection.rowId);
    if (!row || !overlapsBusy(row, selection)) return;
    onSelect(null);
    // The viewer's own booking arriving live is not news; someone else's is.
    const othersBooked = row.busy.some((b) => !b.mine && b.startMin < selection.endMin && selection.startMin < b.endMin);
    if (othersBooked) {
      const message = `${formatMinutes(selection.startMin)} to ${formatMinutes(selection.endMin)} on ${row.label} was just booked by someone else. Pick another time.`;
      setAnnouncement(message);
      liveClearRef.current?.(message);
    }
  }, [rows, selection, onSelect]);

  return (
    <div>
      {compact ? <CompactSlots {...props} handle={mode} /> : <GridSlots {...props} handle={mode} />}
      <div className="visually-hidden" aria-live="polite" data-testid="slotgrid-live">
        {announcement}
      </div>
    </div>
  );
}

function GridSlots({ label, rows, openMin, closeMin, slotMinutes = 30, selection, onSelect, rowHeader = "Resource", minStartFor, rowUnavailable, minSlotsFor, handle }: ModeProps) {
  const base = useId();
  const slots = useMemo(() => {
    const out: number[] = [];
    for (let m = openMin; m < closeMin; m += slotMinutes) out.push(m);
    return out;
  }, [openMin, closeMin, slotMinutes]);
  const [focus, setFocus] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [anchor, setAnchor] = useState<{ r: number; c: number } | null>(null);
  const cellRefs = useRef(new Map<string, HTMLTableCellElement>());
  const headRefs = useRef(new Map<number, HTMLTableCellElement>());
  const wrapRef = useRef<HTMLDivElement>(null);
  const cornerRef = useRef<HTMLTableCellElement>(null);
  const shouldFocus = useRef(false);

  useEffect(() => {
    if (shouldFocus.current) {
      cellRefs.current.get(`${focus.r}:${focus.c}`)?.focus();
      shouldFocus.current = false;
    }
  }, [focus]);

  useImperativeHandle(
    handle,
    () => ({
      focusRow: (rowId, startMin) => {
        const r = rows.findIndex((x) => x.id === rowId);
        if (r < 0) return;
        const c = Math.max(0, slots.findIndex((m) => m + slotMinutes > startMin));
        setAnchor(null);
        setFocus({ r, c });
        cellRefs.current.get(`${r}:${c}`)?.focus();
      },
    }),
    [rows, slots, slotMinutes],
  );

  // Keep the roving focus inside the grid when rows change.
  useEffect(() => {
    if (focus.r >= rows.length && rows.length > 0) setFocus({ r: rows.length - 1, c: focus.c });
  }, [rows.length, focus]);

  const startOf = (c: number) => slots[c] as number;
  const minStart = (rowId: string) => minStartFor?.(rowId) ?? -1;
  const rowWord = (rowId: string) => rowUnavailable?.(rowId) ?? null;
  const blocked = (r: number, c: number) => {
    const row = rows[r];
    if (!row) return true;
    return stateOf(row, startOf(c), startOf(c) + slotMinutes) !== "free" || startOf(c) < minStart(row.id) || rowWord(row.id) !== null;
  };

  // When the grid shows a new date or set of rows, bring the first selectable column (or
  // the selection) into view beside the sticky row header. Cell widths never change; on a
  // laptop the afternoon is otherwise hidden behind a scrollbar macOS does not draw.
  const scrollKey = `${label}|${rows.map((r) => r.id).join(",")}`;
  useEffect(() => {
    const wrap = wrapRef.current;
    const corner = cornerRef.current;
    if (!wrap || !corner) return;
    let target = selection && rows.some((r) => r.id === selection.rowId) ? slots.findIndex((m) => m >= selection.startMin) : -1;
    if (target < 0) {
      for (let c = 0; c < slots.length && target < 0; c++) for (let r = 0; r < rows.length; r++) if (!blocked(r, c)) target = c;
    }
    const head = target >= 0 ? headRefs.current.get(target) : undefined;
    if (!head) return;
    const header = corner.offsetWidth;
    const left = head.offsetLeft;
    if (left < wrap.scrollLeft + header || left + head.offsetWidth > wrap.scrollLeft + wrap.clientWidth) {
      wrap.scrollLeft = Math.max(0, left - header);
    }
    // Only a new date or new rows re-scroll; live updates and selections never do.
  }, [scrollKey]);

  const padded = (r: number, c: number): SlotSelection | null => {
    const row = rows[r];
    if (!row || blocked(r, c)) return null;
    return paddedFrom(row.id, c, minSlotsFor?.(row.id) ?? 1, slots, slotMinutes, (k) => blocked(r, k));
  };

  /** The range from the anchor to the focused cell, if it is entirely free and in one row. */
  const extendedRange = (): SlotSelection | null => {
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
        // A Shift-extended range is taken as it is; otherwise the shortest valid booking.
        const extended = anchor && anchor.r === focus.r && anchor.c !== focus.c;
        const range = extended ? extendedRange() : padded(focus.r, focus.c);
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

  const range = extendedRange();
  const inPending = (r: number, c: number) =>
    !!anchor && !!range && anchor.r === r && rows[r]?.id === range.rowId && startOf(c) >= range.startMin && startOf(c) < range.endMin;
  const inSelection = (r: number, c: number) =>
    !!selection && rows[r]?.id === selection.rowId && startOf(c) >= selection.startMin && startOf(c) < selection.endMin;

  return (
    <div className={styles.wrap} ref={wrapRef} data-testid="slotgrid-scroller">
      <table role="grid" aria-label={label} aria-describedby={`${base}-help`} className={styles.grid}>
        <thead>
          <tr>
            <th scope="col" className={styles.corner} ref={cornerRef}>
              {rowHeader}
            </th>
            {slots.map((m, c) => (
              <th
                key={m}
                scope="col"
                className={styles.timeHeader}
                data-start={m}
                ref={(el) => {
                  if (el) headRefs.current.set(c, el);
                  else headRefs.current.delete(c);
                }}
              >
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
                const closed = rowWord(row.id);
                const past = !closed && m < minStart(row.id);
                const unavailable = state === "free" && (closed !== null || past);
                const selected = inSelection(r, c) || inPending(r, c);
                const words = state === "mine" ? "your booking" : state === "busy" ? "booked" : closed ? closed : past ? "past" : "available";
                const classes = [
                  styles.cell,
                  state === "busy" ? styles.busy : "",
                  state === "mine" ? styles.mine : "",
                  unavailable ? styles.unavailable : "",
                  selected ? styles.selected : "",
                ].join(" ");
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
                    aria-disabled={state !== "free" || unavailable ? true : undefined}
                    aria-label={`${row.label}, ${formatMinutes(m)} to ${formatMinutes(m + slotMinutes)}, ${words}`}
                    data-row={row.id}
                    data-start={m}
                    onKeyDown={onKeyDown}
                    onClick={(e) => {
                      setFocus({ r, c });
                      if (state !== "free" || unavailable) return;
                      if (e.shiftKey && selection && selection.rowId === row.id) {
                        const lo = Math.min(selection.startMin, m);
                        const hi = Math.max(selection.endMin, m + slotMinutes);
                        const candidate = { rowId: row.id, startMin: lo, endMin: hi };
                        if (!overlapsBusy(row, candidate)) onSelect(candidate);
                      } else {
                        setAnchor(null);
                        const first = padded(r, c);
                        if (first) onSelect(first);
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
        <span>Click a start time; Shift+click a later time to extend. Arrow keys move, Shift with Left or Right extends, Enter selects, Escape clears.</span>
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
        <span>
          <span className={`${styles.swatch} ${styles.unavailable}`} aria-hidden="true" />
          Past or closed
        </span>
      </p>
    </div>
  );
}

function CompactSlots({ label, rows, openMin, closeMin, slotMinutes = 30, selection, onSelect, rowHeader = "Resource", minStartFor, rowUnavailable, minSlotsFor, handle }: ModeProps) {
  const base = useId();
  const [rowId, setRowId] = useState<string>(selection?.rowId ?? rows[0]?.id ?? "");
  const row = rows.find((r) => r.id === rowId) ?? rows[0];
  const listRef = useRef<HTMLUListElement>(null);
  const [focusTick, setFocusTick] = useState(0);
  // Follow a selection made elsewhere, but let the viewer browse other rows freely.
  const selectedRow = selection?.rowId;
  useEffect(() => {
    if (selectedRow) setRowId(selectedRow);
  }, [selectedRow]);
  useImperativeHandle(
    handle,
    () => ({
      focusRow: (id) => {
        setRowId(id);
        setFocusTick((t) => t + 1);
      },
    }),
    [],
  );
  useEffect(() => {
    if (focusTick > 0) listRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
  }, [focusTick]);
  if (!row) return <p>No {rowHeader.toLowerCase()}s match.</p>;
  const slots: number[] = [];
  for (let m = openMin; m < closeMin; m += slotMinutes) slots.push(m);
  const minStart = minStartFor?.(row.id) ?? -1;
  const closed = rowUnavailable?.(row.id) ?? null;

  const blockedAt = (c: number) => {
    const m = slots[c] as number;
    return stateOf(row, m, m + slotMinutes) !== "free" || m < minStart || closed !== null;
  };
  const pick = (m: number) => {
    const first = paddedFrom(row.id, slots.indexOf(m), minSlotsFor?.(row.id) ?? 1, slots, slotMinutes, blockedAt);
    const inRow = selection && selection.rowId === row.id ? selection : null;
    if (inRow && m > inRow.startMin && m < inRow.endMin) {
      // A tap inside the selection moves its end there.
      onSelect({ rowId: row.id, startMin: inRow.startMin, endMin: m + slotMinutes });
    } else if (inRow && m >= inRow.endMin) {
      const extended = { rowId: row.id, startMin: inRow.startMin, endMin: m + slotMinutes };
      onSelect(overlapsBusy(row, extended) ? first : extended);
    } else {
      onSelect(first);
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
      <ul ref={listRef} className={styles.chips} aria-label={`${label}: ${row.label}`} aria-describedby={`${base}-help`}>
        {slots.map((m) => {
          const state = stateOf(row, m, m + slotMinutes);
          const selected = !!selection && selection.rowId === row.id && m >= selection.startMin && m < selection.endMin;
          const word = state === "mine" ? "your booking" : state === "busy" ? "booked" : closed ? closed : m < minStart ? "past" : null;
          const unavailable = state === "free" && word !== null;
          return (
            <li key={m}>
              <button
                type="button"
                className={`${styles.chip} ${unavailable ? styles.chipUnavailable : ""}`}
                disabled={state !== "free" || unavailable}
                aria-pressed={selected}
                aria-label={`${formatMinutes(m)} to ${formatMinutes(m + slotMinutes)}${word ? `, ${word}` : ""}`}
                onClick={() => pick(m)}
              >
                {formatMinutes(m)}
              </button>
            </li>
          );
        })}
      </ul>
      <p id={`${base}-help`} className={styles.legend}>
        Tap a start time, then a later time to extend.
      </p>
      {selection ? (
        <div>
          <Button variant="secondary" onClick={() => onSelect(null)}>
            Clear selection
          </Button>
        </div>
      ) : null}
    </div>
  );
}
