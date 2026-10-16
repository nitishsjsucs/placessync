// A share drawn on a fixed 0 to 100% track (VIZ-06), next to its printed percentage:
// a 38% space draws a bar 38% of the track wide, never scaled to the busiest space.
// Hairline ticks mark 25, 50 and 75%. The bar is aria-hidden; the number carries it.
import styles from "./bars.module.css";
import { barWidth, percent } from "./held-ahead.ts";

export function FixedBar({ value, tone = "primary" }: { value: number; tone?: "primary" | "context" }) {
  return (
    <span className={styles.cell}>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.tick} style={{ left: "25%" }} />
        <span className={styles.tick} style={{ left: "50%" }} />
        <span className={styles.tick} style={{ left: "75%" }} />
        <span className={`${styles.bar} ${tone === "context" ? styles.context : ""}`} style={{ width: barWidth(value) }} data-testid="fixed-bar" />
      </span>
      <span className={styles.value}>{percent(value)}</span>
    </span>
  );
}
