// One provider's suggestions by what staff did with them (VIZ-09): a real table, rows
// the suggested category, columns the final one. Every cell prints its count; the
// shading by share of the row only repeats it (a validated 5-step ramp with an ink per
// step). The diagonal is "kept". A headline names the most changed pair.
import { CATEGORIES, CATEGORY_LABELS, type Category } from "../../shared/triage/categories.ts";
import { providerLabel } from "../../shared/triage/provider-labels.ts";
import styles from "./matrix.module.css";
import { type Matrix, SHORT_CATEGORY, TINY_CATEGORY, mostChanged, shareBin } from "./kept-matrix.ts";

const times = (n: number) => `${n} ${n === 1 ? "time" : "times"}`;

export function headline(m: Matrix): string {
  const top = mostChanged(m);
  if (!top) return "Staff kept every suggestion.";
  return `Most changed: ${CATEGORY_LABELS[top.from]} suggestions became ${CATEGORY_LABELS[top.to]} ${times(top.n)}.`;
}

function Name({ category }: { category: Category }) {
  // One of the two words shows, by width (CSS); the other is display: none.
  return (
    <abbr title={CATEGORY_LABELS[category]}>
      <span className={styles.wide}>{SHORT_CATEGORY[category]}</span>
      <span className={styles.narrow}>{TINY_CATEGORY[category]}</span>
    </abbr>
  );
}

export function KeptMatrix({ matrix }: { matrix: Matrix }) {
  return (
    <div className={styles.block}>
      <p className={styles.headline}>{headline(matrix)}</p>
      <div className={styles.scroll}>
        <table className={styles.matrix}>
          <caption className={styles.caption}>{providerLabel(matrix.provider)}: suggested category by final category</caption>
          <thead>
            <tr>
              <th scope="col" className={styles.corner}>
                Suggested
              </th>
              {CATEGORIES.map((c) => (
                <th key={c} scope="col">
                  <Name category={c} />
                </th>
              ))}
              <th scope="col">Kept</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.suggested}>
                <th scope="row">
                  <Name category={row.suggested} />
                </th>
                {row.counts.map((n, i) => {
                  const bin = shareBin(n, row.total);
                  const diagonal = CATEGORIES[i] === row.suggested;
                  const share = row.total ? Math.round((n / row.total) * 100) : 0;
                  return (
                    <td key={CATEGORIES[i]} className={`${styles.cell} ${styles[`bin${bin}`]} ${diagonal ? styles.diagonal : ""}`} data-bin={bin}>
                      {n}
                      <span className="visually-hidden">
                        {diagonal ? ", kept" : ""}, {share}% of this row
                      </span>
                    </td>
                  );
                })}
                <td className={styles.keptCell}>
                  <span className="visually-hidden">kept </span>
                  {row.kept} of {row.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** The ramp's key: what each shade means. */
export function ShareLegend() {
  const steps = ["up to 20%", "up to 40%", "up to 60%", "up to 80%", "up to 100%"];
  return (
    <p className={styles.legend}>
      <span>Shade: share of the row.</span>
      {steps.map((label, i) => (
        <span key={label} className={styles.legendItem}>
          <span className={`${styles.swatch} ${styles[`bin${i + 1}`]}`} aria-hidden="true" />
          {label}
        </span>
      ))}
    </p>
  );
}
