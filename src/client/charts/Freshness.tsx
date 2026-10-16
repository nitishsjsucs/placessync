// Whether the admin reports include the latest bookings (VIZ-07). Bookings reach D1
// through the ledger's transactional outbox (ADR 0003), so a report can briefly miss the
// newest changes. Judged by the outbox depth alone: comparing ledger and D1 versions
// would read as "lagging" forever after a dev reset or an import. When the status cannot
// be fetched, nothing is shown and the reports still render.
import type { ProjectionStatusResponse } from "../../shared/api.ts";
import { formatMinutes, siteClock } from "../../shared/time.ts";
import { Button } from "../ui/Button.tsx";
import styles from "./charts.module.css";
import { WarningIcon } from "./icons.tsx";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "16:05" on the site's today, else "October 14, 16:05". */
export function copiedAt(iso: string, timeZone: string, today: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const c = siteClock(timeZone, ms);
  const time = formatMinutes(c.minutes);
  if (c.date === today) return time;
  const [, m, d] = c.date.split("-").map(Number) as [number, number, number];
  return `${MONTHS[m - 1]} ${d}, ${time}`;
}

export interface FreshnessProps {
  status: ProjectionStatusResponse | null;
  timeZone: string;
  today: string;
  onRefresh: () => void;
  refreshing?: boolean;
}

export function Freshness({ status, timeZone, today, onRefresh, refreshing = false }: FreshnessProps) {
  if (!status) return null;
  const refresh = (
    <Button variant="secondary" size="sm" onClick={onRefresh} loading={refreshing}>
      Refresh
    </Button>
  );
  if (status.lastFlushError) {
    return (
      <div className={styles.freshness} data-testid="freshness">
        <p className={styles.warnLine}>
          <WarningIcon />
          Copying bookings to reports is failing; bookings themselves are safe in the ledger.
        </p>
        {refresh}
      </div>
    );
  }
  if (status.outboxDepth > 0) {
    const n = status.outboxDepth;
    return (
      <div className={styles.freshness} data-testid="freshness">
        <p>
          {n === 1 ? "1 booking change had" : `${n} booking changes had`} not reached these reports when they loaded. The ledger copies them shortly; in production this can take up to a
          minute.
        </p>
        {refresh}
      </div>
    );
  }
  return (
    <div className={styles.freshness} data-testid="freshness">
      <p className={styles.muted}>
        {status.d1 ? `Reports include every booking change (last copied ${copiedAt(status.d1.updatedAt, timeZone, today)}).` : "No booking has been copied to reports yet."}
      </p>
    </div>
  );
}
