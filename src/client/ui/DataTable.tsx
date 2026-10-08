// DataTable (SPEC 14.2): a semantic table with a caption, an empty state, optional row
// actions, and stacked rows with visible column labels under 640 px (each cell carries
// its column label in data-label for the CSS).
import type { ReactNode } from "react";
import styles from "./DataTable.module.css";

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
}

export interface DataTableProps<Row> {
  columns: readonly Column<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  caption: string;
  empty?: ReactNode;
  rowActions?: (row: Row) => ReactNode;
  actionsHeader?: string;
}

export function DataTable<Row>({ columns, rows, rowKey, caption, empty = "Nothing to show.", rowActions, actionsHeader = "Actions" }: DataTableProps<Row>) {
  return (
    <div className={styles.wrap}>
      <table className={styles.table}>
        <caption className={styles.caption}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.header}
              </th>
            ))}
            {rowActions ? <th scope="col">{actionsHeader}</th> : null}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (rowActions ? 1 : 0)} className={styles.empty} data-label="">
                {empty}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
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
