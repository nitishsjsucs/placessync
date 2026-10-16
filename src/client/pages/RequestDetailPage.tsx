// Request detail (SPEC 14.1): status, the suggestion with its provider label, the final
// category and the event timeline; the reporter can cancel while nobody has picked it up.
//
// While the request is still "submitted" (classification pending) the page checks again
// every 10 s while it is visible, for at most 3 minutes from opening (at most 18 GETs,
// which matters on the Workers Free plan's shared request allowance), and offers Check
// again. Cancelling asks first, and a refused cancel is shown under the button with the
// server's reason, never instead of the request.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { RequestDetailResponse } from "../../shared/api.ts";
import { ApiClientError, api } from "../api/client.ts";
import { useReadySession } from "../session/SessionProvider.tsx";
import { useAnnounce } from "../shell/Announcer.tsx";
import { LoadError } from "../shell/LoadError.tsx";
import { useStatusBanner } from "../shell/StatusBanner.tsx";
import { Button } from "../ui/Button.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import styles from "./pages.module.css";
import { categoryLabel, eventLabel, formatWhen, statusLabel, suggestionText, timelineEvents } from "./requests-ui.ts";
import { usePageTitle } from "./usePageTitle.ts";

export const POLL_MS = 10_000;
export const POLL_WINDOW_MS = 180_000;

interface DetailState {
  created?: boolean;
  triage?: string;
  /** The staff tab a row link was followed from, such as /staff?tab=working. */
  from?: string;
}

export function RequestDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { employee } = useReadySession();
  const announce = useAnnounce();
  const banner = useStatusBanner();
  const [data, setData] = useState<RequestDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const cancelErrorRef = useRef<HTMLParagraphElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  usePageTitle(data ? data.request.title : "Request");

  const state = (location.state as DetailState | null) ?? null;
  const from = typeof state?.from === "string" && state.from.startsWith("/staff") ? state.from : null;
  // The "submitted" notice belongs to the moment of submitting: keep it for this view,
  // then drop it from history so a reload does not show it again.
  const [created] = useState(() => (state?.created ? { triage: state.triage } : null));
  useEffect(() => {
    if (state?.created) navigate(`${location.pathname}${location.search}`, { replace: true, state: from ? { from } : null });
  }, [state?.created, navigate, location.pathname, location.search, from]);

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
    setCancelError(null);
    void load();
  }, [load]);

  // Check again while classification is pending: every 10 s, only while visible, and only
  // within 3 minutes of opening the page. Stops as soon as the status moves on.
  const openedAt = useRef(Date.now());
  const awaitingTriage = data?.request.status === "submitted";
  useEffect(() => {
    if (!awaitingTriage) return;
    const timer = setInterval(() => {
      if (Date.now() - openedAt.current >= POLL_WINDOW_MS) {
        clearInterval(timer);
        return;
      }
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [awaitingTriage, load]);

  useEffect(() => {
    if (cancelError) cancelErrorRef.current?.focus();
  }, [cancelError]);

  async function cancel() {
    setPending(true);
    setCancelError(null);
    try {
      await api.postRaw(`/api/requests/${encodeURIComponent(id)}/cancel`);
      announce("Request cancelled.");
      banner.show({ text: "Request cancelled.", focus: true });
      setConfirming(false);
    } catch (err) {
      setConfirming(false);
      setCancelError(err instanceof ApiClientError && err.status === 409 ? err.message : "Could not cancel. Check your connection and try again.");
    } finally {
      setPending(false);
      void load();
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
  if (error && !data) {
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
  const isStaff = employee.role === "facilities_staff" || employee.role === "facilities_admin";
  const back = from
    ? { to: from, label: "Back to the staff queue" }
    : isStaff && r.reporterId !== employee.id
      ? { to: "/staff", label: "Back to the staff queue" }
      : { to: "/requests", label: "Back to my requests" };

  return (
    <section className={styles.stack}>
      <h1>{r.title}</h1>
      {/* The notice describes a request still waiting: gone once it is cancelled or picked up. */}
      {created && (r.status === "submitted" || r.status === "awaiting_review") ? (
        <p role="status" className={styles.notice}>
          {created.triage === "pending"
            ? "Your request was submitted. Classification pending; staff can still review it."
            : "Your request was submitted. It is being categorized automatically, then facilities staff will review it."}
        </p>
      ) : null}
      <dl className={styles.dl}>
        <dt>Status</dt>
        <dd ref={statusRef} tabIndex={-1}>
          {statusLabel(r.status)}
        </dd>
        <dt>Suggested category</dt>
        <dd className={styles.row}>
          <span>{suggestionText({ status: r.status, triageState: r.triageState, suggestion })}</span>
          {r.status === "submitted" ? (
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Check again
            </Button>
          ) : null}
        </dd>
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
      {canCancel || cancelError ? (
        <div className={styles.stack}>
          {canCancel ? (
            <div>
              <Button variant="danger" onClick={() => setConfirming(true)}>
                Cancel this request
              </Button>
            </div>
          ) : null}
          {cancelError ? (
            <p ref={cancelErrorRef} tabIndex={-1} role="alert" className={styles.notice}>
              {cancelError}
            </p>
          ) : null}
        </div>
      ) : null}
      <Link to={back.to}>{back.label}</Link>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Cancel this request?"
        dismissable={!pending}
        initialFocus={keepRef}
        returnFocus={statusRef}
        actions={
          <>
            <Button ref={keepRef} variant="secondary" onClick={() => setConfirming(false)} disabled={pending}>
              Keep request
            </Button>
            <Button variant="danger" onClick={() => void cancel()} loading={pending}>
              Cancel request
            </Button>
          </>
        }
      >
        <p>
          <strong>{r.title}</strong>
        </p>
        <p>It leaves the facilities staff queue, and a cancelled request cannot be reopened.</p>
      </Dialog>
    </section>
  );
}
