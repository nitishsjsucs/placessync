// The request page's progress tracker (VIZ-03): an ordered list of the five steps, with
// the current one marked aria-current="step". Every step says in words whether it is
// Done, Now, Not yet, Skipped or Cancelled, so the check marks and colors only repeat
// what the text says. From 640 px it is a horizontal track; below, a vertical list.
// The "so far" time moves once a minute from the browser clock (clamped at zero) and
// makes no request.
import { type CSSProperties, useEffect, useId, useState } from "react";
import type { FacilitiesRequest, RequestEvent, Suggestion } from "../../shared/api.ts";
import { elapsed, formatWhen } from "../pages/requests-ui.ts";
import chartStyles from "./charts.module.css";
import styles from "./progress.module.css";
import { CheckIcon, WarningIcon } from "./icons.tsx";
import { type ProgressStep, progressSteps } from "./request-progress.ts";

export interface RequestProgressProps {
  request: FacilitiesRequest;
  suggestion: Suggestion | null;
  events: readonly RequestEvent[];
}

const STATE_WORD: Record<ProgressStep["state"], string> = { done: "Done", current: "Now", future: "Not yet", skipped: "Skipped", cancelled: "Cancelled" };

export function RequestProgress({ request, suggestion, events }: RequestProgressProps) {
  const headingId = useId();
  const [now, setNow] = useState(() => Date.now());
  const steps = progressSteps(request, suggestion, events, now);
  const live = steps.some((s) => s.state === "current");

  useEffect(() => {
    if (!live) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [live]);

  return (
    <section className={styles.progress}>
      <h2 id={headingId}>Progress</h2>
      <ol aria-labelledby={headingId} className={styles.steps} style={{ "--steps": steps.length } as CSSProperties}>
        {steps.map((s) => (
          <li key={s.key} className={`${styles.step} ${styles[s.state]}`} aria-current={s.state === "current" ? "step" : undefined} data-state={s.state}>
            <span className={styles.node} aria-hidden="true">
              {s.state === "done" ? <CheckIcon /> : null}
            </span>
            <span className={styles.text}>
              <strong className={styles.label}>{s.label}</strong>
              {s.state === "current" && s.now ? (
                <span>
                  Now: {s.now.who}, {elapsed(s.now.sinceMinutes)} so far
                </span>
              ) : s.state === "done" || s.state === "cancelled" ? (
                <span>
                  {s.state === "cancelled" ? "By the reporter" : STATE_WORD[s.state]}
                  {s.at ? (
                    <>
                      , <time dateTime={s.at}>{formatWhen(s.at)}</time>
                    </>
                  ) : null}
                </span>
              ) : (
                <span className={styles.quiet}>{STATE_WORD[s.state]}</span>
              )}
              {s.afterMinutes !== null ? <span className={styles.quiet}>after {elapsed(s.afterMinutes)}</span> : null}
              {s.detail ? <span className={styles.detail}>{s.detail}</span> : null}
              {s.now?.overdue ? (
                <span className={chartStyles.warn}>
                  <WarningIcon />
                  Review overdue; staff were reminded
                </span>
              ) : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** A five-segment meter for a status, drawn beside its words (aria-hidden). */
export function StepMeter({ done, current }: { done: number; current: number | null }) {
  return (
    <span className={styles.meter} aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= done ? styles.segDone : i === current ? styles.segCurrent : styles.segTodo} />
      ))}
    </span>
  );
}
