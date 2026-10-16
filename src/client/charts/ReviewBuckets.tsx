// Time from submission to staff review in four buckets (VIZ-09), so the admin sees how
// many requests waited past the 24-hour review timer, not only the median. One series in
// --color-primary; every column prints its count, and the over-24-hours column carries a
// warning icon and words. Show table gives the same numbers as a table.
import { useId, useState } from "react";
import type { RequestsReport } from "../../shared/api.ts";
import { Button } from "../ui/Button.tsx";
import { DataTable } from "../ui/DataTable.tsx";
import chartStyles from "./charts.module.css";
import styles from "./buckets.module.css";
import { WarningIcon } from "./icons.tsx";

type Bucket = NonNullable<RequestsReport["reviewBuckets"]>[number];

export const BUCKET_LABELS: Record<Bucket["bucket"], string> = {
  under_1h: "Under 1 hour",
  "1h_to_4h": "1 to 4 hours",
  "4h_to_24h": "4 to 24 hours",
  over_24h: "Over 24 hours",
};

export function bucketsSummary(buckets: readonly Bucket[]): string {
  return `Reviews by time from submission: ${buckets.map((b) => `${BUCKET_LABELS[b.bucket].toLowerCase()} ${b.n}`).join(", ")}.`;
}

export function ReviewBuckets({ buckets, median }: { buckets: readonly Bucket[]; median: string }) {
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  const tableId = useId();
  const total = buckets.reduce((n, b) => n + b.n, 0);
  const max = Math.max(1, ...buckets.map((b) => b.n));
  return (
    <section className={chartStyles.section} aria-labelledby={titleId}>
      <div className={chartStyles.sectionHead}>
        <h2 id={titleId}>Time from submission to staff review</h2>
        {total > 0 ? (
          <Button variant="secondary" size="sm" aria-expanded={showTable} aria-controls={tableId} onClick={() => setShowTable((s) => !s)}>
            Show table<span className="visually-hidden">: time to review</span>
          </Button>
        ) : null}
      </div>
      <p className={chartStyles.muted}>{median}</p>
      {total === 0 ? (
        <p className={chartStyles.muted}>No reviews in this range.</p>
      ) : (
        <div className={styles.chart} role="img" aria-label={bucketsSummary(buckets)} data-testid="review-buckets">
          {buckets.map((b) => (
            <div key={b.bucket} className={styles.slot} data-bucket={b.bucket}>
              <div className={styles.area}>
                <span className={styles.count}>{b.n}</span>
                {b.n > 0 ? <span className={styles.column} style={{ height: `${(b.n / max) * 100}%` }} /> : null}
              </div>
              <span className={`${styles.label} ${b.bucket === "over_24h" ? `${chartStyles.warn} ${styles.wrapPill}` : ""}`}>
                {b.bucket === "over_24h" ? <WarningIcon /> : null}
                {BUCKET_LABELS[b.bucket]}
              </span>
            </div>
          ))}
        </div>
      )}
      <div id={tableId} hidden={!showTable}>
        {showTable ? (
          <DataTable
            caption="Time from submission to staff review"
            columns={[
              { key: "bucket", header: "Time to review", render: (b: Bucket) => BUCKET_LABELS[b.bucket] },
              { key: "n", header: "Reviews", render: (b: Bucket) => b.n },
            ]}
            rows={buckets}
            rowKey={(b) => b.bucket}
            stacked={false}
          />
        ) : null}
      </div>
    </section>
  );
}
