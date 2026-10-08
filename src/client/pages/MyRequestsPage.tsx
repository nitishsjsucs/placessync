// My requests (SPEC 14.1): monitoring request status, the suggested category with its
// provider label, and the final category.
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { MyRequestsResponse, type RequestWithSuggestion } from "../../shared/api.ts";
import { api } from "../api/client.ts";
import { DataTable } from "../ui/DataTable.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import styles from "./pages.module.css";
import { categoryLabel, formatWhen, statusLabel, suggestionText } from "./requests-ui.ts";
import { usePageTitle } from "./usePageTitle.ts";

const TABS = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
];
const CLOSED = new Set(["resolved", "cancelled"]);

export function MyRequestsPage() {
  usePageTitle("My requests");
  const [tab, setTab] = useState("open");
  const [rows, setRows] = useState<RequestWithSuggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/api/requests", MyRequestsResponse)
      .then((r) => setRows(r.requests))
      .catch(() => setError("Your requests could not be loaded."));
  }, []);

  const columns = [
    { key: "title", header: "Request", render: (r: RequestWithSuggestion) => <Link to={`/requests/${r.id}`}>{r.title}</Link> },
    { key: "status", header: "Status", render: (r: RequestWithSuggestion) => statusLabel(r.status) },
    { key: "suggested", header: "Suggested category", render: (r: RequestWithSuggestion) => suggestionText(r) },
    { key: "final", header: "Final category", render: (r: RequestWithSuggestion) => (r.finalCategory ? categoryLabel(r.finalCategory) : "Not reviewed yet") },
    { key: "submitted", header: "Submitted", render: (r: RequestWithSuggestion) => formatWhen(r.createdAt) },
  ];

  return (
    <section className={styles.stack}>
      <div className={styles.row}>
        <h1>My requests</h1>
        <Link to="/requests/new">Report an issue</Link>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {rows === null && !error ? <p role="status">Loading…</p> : null}
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Requests">
        {(id) => (
          <DataTable
            caption={id === "open" ? "Open requests" : "Closed requests"}
            columns={columns}
            rows={(rows ?? []).filter((r) => (id === "open" ? !CLOSED.has(r.status) : CLOSED.has(r.status)))}
            rowKey={(r) => r.id}
            empty={id === "open" ? "No open requests." : "No closed requests."}
          />
        )}
      </Tabs>
    </section>
  );
}
