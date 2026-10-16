// "Work at a glance" (VIZ-01): one tile per stage that needs facilities staff, with the
// count and the oldest wait, so the first question on the staff page ("what needs me
// first?") is answered before reading a table. Each tile links to the tab that lists
// those requests. Not a chart: the numbers are the figure.
import { Link } from "react-router";
import styles from "./charts.module.css";
import { WarningIcon } from "./icons.tsx";
import { type SummaryTile, countText, nothingWaiting, oldestText, tileSentence } from "./work-summary.ts";

export interface WorkSummaryProps {
  tiles: readonly SummaryTile[];
  /** Called after a tile is activated, so the page can move focus to the tab it opened. */
  onActivate?: (tile: SummaryTile) => void;
}

export function WorkSummary({ tiles, onActivate }: WorkSummaryProps) {
  return (
    <div className={styles.stackTight}>
      <ul aria-label="Work at a glance" className={styles.tiles}>
        {tiles.map((t) => {
          const oldest = oldestText(t);
          return (
            <li key={t.id}>
              <Link to={t.to} replace aria-label={tileSentence(t)} className={styles.tileLink} data-tile={t.id} onClick={() => onActivate?.(t)}>
                <span className={styles.tileLabel}>{t.label}</span>
                <span className={styles.tileValue}>{countText(t)}</span>
                {oldest ? <span className={styles.tileMeta}>{oldest}</span> : null}
                {t.overDay ? (
                  <span className={styles.warn}>
                    <WarningIcon />
                    {t.overDay} waiting over 24 h
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
      {nothingWaiting(tiles) ? <p className={styles.muted}>Nothing is waiting for staff.</p> : null}
    </div>
  );
}
