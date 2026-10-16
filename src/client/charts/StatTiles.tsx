// The Utilization tab's four figures (VIZ-07): how full the office was on the days that
// have passed (desks and rooms apart), how much is already booked ahead, and how many
// bookings were cancelled. Numbers, not charts: each tile answers one question.
import { longDate } from "../ui/DateGrid.tsx";
import styles from "./charts.module.css";
import { type Split, percent } from "./held-ahead.ts";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export interface StatTilesProps {
  split: Split;
  /** The site's today: "from today" when the days ahead start today, else their first date. */
  today: string;
}

/** "from today to Friday, October 30, 2026", or from the range's first date when it starts later. */
export function aheadSpan(ahead: { from: string; to: string }, today: string): string {
  return `from ${ahead.from === today ? "today" : longDate(ahead.from)} to ${longDate(ahead.to)}`;
}

export function StatTiles({ split, today }: StatTilesProps) {
  const held = (kind: "desk" | "room") => {
    const k = split.kinds[kind];
    const word = kind === "desk" ? "desk" : "room";
    return (
      <li className={styles.tile} key={kind}>
        <span className={styles.tileLabel}>{kind === "desk" ? "Desk" : "Room"} time booked, past days</span>
        {k.heldUtilization === null ? (
          <span className={styles.tileNote}>{split.held && split.held.weekdays > 0 ? `No ${word}s bookable now.` : "No past days in this range."}</span>
        ) : (
          <>
            <span className={styles.tileValue}>{percent(k.heldUtilization)}</span>
            <span className={styles.tileMeta}>of the {plural(k.activeSpaces, word)} bookable now</span>
          </>
        )}
      </li>
    );
  };
  const share = split.allBookings > 0 ? percent(split.cancelled / split.allBookings) : null;
  return (
    <ul className={styles.tiles} aria-label="Utilization at a glance">
      {held("desk")}
      {held("room")}
      <li className={styles.tile}>
        <span className={styles.tileLabel}>Booked ahead</span>
        {split.ahead ? (
          <>
            <span className={styles.tileValue}>{plural(split.bookedAhead, "booking")}</span>
            <span className={styles.tileMeta}>{aheadSpan(split.ahead, today)}</span>
          </>
        ) : (
          <span className={styles.tileNote}>No days ahead in this range.</span>
        )}
      </li>
      <li className={styles.tile}>
        <span className={styles.tileLabel}>Cancelled</span>
        {share === null ? (
          <span className={styles.tileNote}>No bookings in this range.</span>
        ) : (
          <>
            <span className={styles.tileValue}>
              {split.cancelled} of {split.allBookings}
            </span>
            <span className={styles.tileMeta}>{share} of bookings in the range</span>
          </>
        )}
      </li>
    </ul>
  );
}
