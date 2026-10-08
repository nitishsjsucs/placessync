// DataTable (SPEC 14.2): a semantic table with a caption, an empty state, optional row
// actions, and stacked rows with visible column labels under 640 px (each cell carries
// its column label in data-label for the CSS). Columns with sortValue are sortable:
// header buttons set aria-sort on wide screens, and a native "Sort by" select replaces
// them in the stacked layout, where the header row is visually hidden.
import { type ReactNode, useId, useMemo, useState } from "react";
import { COMPACT_QUERY, useMediaQuery } from "../hooks/useMediaQuery.ts";
import styles from "./DataTable.module.css";

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  /** Makes the column sortable by this value. */
  sortValue?: (row: Row) => string | number;
}

export interface SortState {
  key: string;
  direction: "ascending" | "descending";
}

export interface DataTableProps<Row> {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  caption: string;
  empty?: ReactNode;
  rowActions?: (row: Row) => ReactNode;
  actionsHeader?: string;
  /** Controlled sort; omit both to let the table keep its own. */
  sort?: SortState | null;
  onSortChange?: (sort: SortState | null) => void;
  defaultSort?: SortState | null;
}

export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  empty = "Nothing to show.",
  rowActions,
  actionsHeader = "Actions",
  sort: sortProp,
  onSortChange,
  defaultSort = null,
}: DataTableProps<Row>) {
  const compact = useMediaQuery(COMPACT_QUERY);
  const selectId = useId();
  const [own, setOwn] = useState<SortState | null>(defaultSort);
  const sort = sortProp !== undefined ? sortProp : own;
  const setSort = (next: SortState | null) => {
    if (sortProp === undefined) setOwn(next);
    onSortChange?.(next);
  };
  const sortable = columns.filter((c) => c.sortValue);

  const sorted = useMemo(() => {
    const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
    if (!sort || !col?.sortValue) return rows;
    const value = col.sortValue;
    const dir = sort.direction === "ascending" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }, [rows, columns, sort]);

  const toggle = (key: string) => {
    if (sort?.key === key) setSort({ key, direction: sort.direction === "ascending" ? "descending" : "ascending" });
    else setSort({ key, direction: "ascending" });
  };

  return (
    <div className={styles.wrap}>
      {compact && sortable.length > 0 ? (
        <label className={styles.sortSelect} htmlFor={selectId}>
          Sort by
          <select
            id={selectId}
            value={sort ? `${sort.key}:${sort.direction}` : ""}
            onChange={(e) => {
              const [key, direction] = e.target.value.split(":") as [string, SortState["direction"]];
              setSort(e.target.value ? { key, direction } : null);
            }}
          >
            <option value="">Default order</option>
            {sortable.flatMap((c) => [
              <option key={`${c.key}:ascending`} value={`${c.key}:ascending`}>
                {c.header}, ascending
              </option>,
              <option key={`${c.key}:descending`} value={`${c.key}:descending`}>
                {c.header}, descending
              </option>,
            ])}
          </select>
        </label>
      ) : null}
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => {
              const active = sort?.key === c.key;
              return (
                <th key={c.key} scope="col" aria-sort={c.sortValue ? (active ? sort?.direction : "none") : undefined}>
                  {c.sortValue && !compact ? (
                    <button type="button" className={styles.sortButton} onClick={() => toggle(c.key)}>
                      {c.header}
                      <span aria-hidden="true" className={styles.sortIcon}>
                        {active ? (sort?.direction === "ascending" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              );
            })}
            {rowActions ? <th scope="col">{actionsHeader}</th> : null}
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (rowActions ? 1 : 0)} className={styles.empty} data-label="">
                {empty}
              </td>
            </tr>
          ) : (
            sorted.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key} data-label={c.header}>
                    {c.render(row)}
                  </td>
                ))}
                {rowActions ? (
                  <td data-label={actionsHeader}>
                    <div className={styles.actions}>{rowActions(row)}</div>
                  </td>
                ) : null}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
