// Request detail (SPEC 14.1): status, the suggestion with its provider label, the final
// category and the event timeline; the reporter can cancel while nobody has picked it up.
import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router";
import { RequestDetailResponse } from "../../shared/api.ts";
import { ApiClientError, api } from "../api/client.ts";
import { useReadySession } from "../session/SessionProvider.tsx";
import { useAnnounce } from "../shell/Announcer.tsx";
import { LoadError } from "../shell/LoadError.tsx";
import { Button } from "../ui/Button.tsx";
import styles from "./pages.module.css";
import { categoryLabel, eventLabel, formatWhen, statusLabel, suggestionText, timelineEvents } from "./requests-ui.ts";
import { usePageTitle } from "./usePageTitle.ts";

export function RequestDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const { employee } = useReadySession();
  const announce = useAnnounce();
  const [data, setData] = useState<RequestDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending] = useState(false);
  usePageTitle(data ? data.request.title : "Request");
  const created = (location.state as { created?: boolean; triage?: string } | null) ?? null;

  const load = useCallback(
    () =>
      api
        .get(`/api/requests/${encodeURIComponent(id)}`, RequestDetailResponse)
        .then((r) => {
          setData(r);
          setError(null);
        })
        .catch((err) => {
          if (err instanceof ApiClientError && err.status === 404) setNotFound(true);
          else setError("The request could not be loaded.");
        }),
    [id],
  );

  useEffect(() => {
    setData(null);
    setError(null);
    setNotFound(false);
    void load();
  }, [load]);

  async function cancel() {
    setPending(true);
    try {
      await api.postRaw(`/api/requests/${encodeURIComponent(id)}/cancel`);
      announce("Request cancelled.");
      load();
    } catch {
      setError("The request could not be cancelled.");
    } finally {
      setPending(false);
    }
  }

  if (notFound) {
    return (
      <section className={styles.stack}>
        <h1>Request</h1>
        <p role="alert">There is no such request.</p>
        <p>
          <Link to="/requests">My requests</Link>
        </p>
      </section>
    );
  }
  if (error) {
    return (
      <section className={styles.stack}>
        <h1>Request</h1>
        <LoadError
          message={error}
          onRetry={() => {
            setError(null);
            return load();
          }}
        />
      </section>
    );
  }
  if (!data) return <p role="status">Loading the request…</p>;
  const { request: r, suggestion, events } = data;
  const canCancel = r.reporterId === employee.id && (r.status === "submitted" || r.status === "awaiting_review");

  return (
    <section className={styles.stack}>
      <h1>{r.title}</h1>
      {created?.created ? (
        <p role="status" className={styles.notice}>
          {created.triage === "pending"
            ? "Your request was submitted. Classification pending; staff can still review it."
            : "Your request was submitted. It is being categorized automatically, then facilities staff will review it."}
        </p>
      ) : null}
      <dl className={styles.dl}>
        <dt>Status</dt>
        <dd>{statusLabel(r.status)}</dd>
        <dt>Suggested category</dt>
        <dd>{suggestionText({ status: r.status, triageState: r.triageState, suggestion })}</dd>
        {suggestion ? (
          <>
            <dt>Suggestion note</dt>
            <dd>{suggestion.rationale}</dd>
          </>
        ) : null}
        <dt>Final category</dt>
        <dd>{r.finalCategory ? categoryLabel(r.finalCategory) : "Not reviewed yet"}</dd>
        <dt>Space</dt>
        <dd>{r.resourceId ? <Link to={`/resources/${r.resourceId}`}>{r.resourceName ?? r.resourceId}</Link> : "None"}</dd>
        <dt>Location</dt>
        <dd>{r.locationNote || "Not given"}</dd>
        <dt>Reported by</dt>
        <dd>{r.reporterName ?? r.reporterId}</dd>
        <dt>Description</dt>
        <dd>{r.description}</dd>
      </dl>
      <h2>Timeline</h2>
      <ol className={styles.timeline} aria-label="Request timeline">
        {timelineEvents(events).map((e) => (
          <li key={e.id}>
            <strong>{eventLabel(e)}</strong>
            <br />
            <span className={styles.muted}>
              <time dateTime={e.at}>{formatWhen(e.at)}</time>
            </span>
          </li>
        ))}
      </ol>
      {canCancel ? (
        <div>
          <Button variant="danger" onClick={() => void cancel()} loading={pending}>
            Cancel this request
          </Button>
        </div>
      ) : null}
      <Link to="/requests">Back to my requests</Link>
    </section>
  );
}
