// Facilities staff dashboard (SPEC 14.1): the triage queue with suggestions and their
// provider labels, accept, reassign or categorize in a Dialog, work in progress and
// resolved requests, and live staff events.
//
// The tab is kept in ?tab= (replace), so Back from a request returns to it. The queue
// also refreshes on its own: every 60 s while the page is visible, when the page becomes
// visible again, and when the live socket reconnects. A request still in "submitted"
// becomes eligible after 2 minutes without any staff event, so live events alone miss it.
// Resolving cannot be undone, so it asks first and takes an optional note for the
// reporter. Only a 409 is reported as "changed meanwhile"; any other failure says to
// check the connection, inside the dialog, which stays open so a typed note is kept.
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { StaffBookingsResponse, StaffQueueResponse } from "../../shared/api.ts";
import { CATEGORIES } from "../../shared/triage/categories.ts";
import { providerLabel } from "../../shared/triage/provider-labels.ts";
import { ApiClientError, api } from "../api/client.ts";
import { useStaffEvents } from "../live/useStaffEvents.ts";
import { useAnnounce } from "../shell/Announcer.tsx";
import { LoadError } from "../shell/LoadError.tsx";
import { useStatusBanner } from "../shell/StatusBanner.tsx";
import { Button } from "../ui/Button.tsx";
import { Combobox } from "../ui/Combobox.tsx";
import { DataTable } from "../ui/DataTable.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import { TextField } from "../ui/TextField.tsx";
import styles from "./pages.module.css";
import { categoryLabel, statusLabel } from "./requests-ui.ts";
import { timeRange, useSite } from "./site.ts";
import { usePageTitle } from "./usePageTitle.ts";

type QueueItem = StaffQueueResponse["requests"][number];
type ReviewMode = "accept" | "reassign" | "categorize";

const TABS = [
  { id: "queue", label: "Triage queue" },
  { id: "working", label: "In progress" },
  { id: "resolved", label: "Resolved" },
  { id: "today", label: "Today's bookings" },
];
export const QUEUE_REFRESH_MS = 60_000;
const SAVE_FAILED = "Could not save. Check your connection and try again.";
const NOTE_MAX = 500;

function hhmm(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}
type Booking = StaffBookingsResponse["bookings"][number];
const CATEGORY_OPTIONS = CATEGORIES.map((c) => ({ value: c, label: categoryLabel(c) }));

function age(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)} h`;
  return `${Math.floor(minutes / 1440)} d`;
}

export function StaffDashboardPage() {
  usePageTitle("Facilities staff");
  const site = useSite();
  const announce = useAnnounce();
  const banner = useStatusBanner();
  const [params, setParams] = useSearchParams();
  const tabParam = params.get("tab");
  const tab = TABS.some((t) => t.id === tabParam) ? (tabParam as string) : "queue";
  const setTab = (id: string) => setParams(id === "queue" ? new URLSearchParams() : new URLSearchParams({ tab: id }), { replace: true });
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [working, setWorking] = useState<QueueItem[]>([]);
  const [resolved, setResolved] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ item: QueueItem; mode: ReviewMode } | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<QueueItem | null>(null);
  const [note, setNote] = useState("");
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [resolvePending, setResolvePending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [today, setToday] = useState<Booking[] | null>(null);
  // Today's bookings has its own error, so it never hides or replaces the queue's.
  const [todayError, setTodayError] = useState<string | null>(null);
  const [todayTick, setTodayTick] = useState(0);

  useEffect(() => {
    if (tab !== "today") return;
    let cancelled = false;
    api
      .get(`/api/staff/bookings?date=${site.today}`, StaffBookingsResponse)
      .then((r) => {
        if (cancelled) return;
        setToday(r.bookings);
        setTodayError(null);
      })
      .catch(() => {
        if (!cancelled) setTodayError("Today's bookings could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [tab, site.today, todayTick]);

  const load = useCallback(async () => {
    try {
      const [q, assigned, inProgress, done] = await Promise.all([
        api.get("/api/staff/requests", StaffQueueResponse),
        api.get("/api/staff/requests?status=assigned", StaffQueueResponse),
        api.get("/api/staff/requests?status=in_progress", StaffQueueResponse),
        api.get("/api/staff/requests?status=resolved", StaffQueueResponse),
      ]);
      setQueue(q.requests);
      setWorking([...assigned.requests, ...inProgress.requests]);
      setResolved(done.requests);
      setUpdatedAt(new Date());
      setError(null);
    } catch {
      setError("The queue could not be loaded.");
    }
  }, []);

  /** Only the triage queue: what the timed and reconnect refreshes need. */
  const loadQueue = useCallback(async () => {
    try {
      const q = await api.get("/api/staff/requests", StaffQueueResponse);
      setQueue(q.requests);
      setUpdatedAt(new Date());
      setError(null);
    } catch {
      setError("The queue could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const visible = () => document.visibilityState === "visible";
    const timer = setInterval(() => {
      if (visible()) void loadQueue();
    }, QUEUE_REFRESH_MS);
    const onVisibility = () => {
      if (visible()) void loadQueue();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [loadQueue]);

  const liveStatus = useStaffEvents(site.siteId, (e) => {
    if (e.event === "triage_ready") announce("A new request is ready for review.");
    if (e.event === "triage_unavailable") announce("A request needs manual categorization.");
    if (e.event === "triage_overdue") announce("A review is overdue.");
    void load();
  });

  // Events sent while the socket was down are not replayed: refetch the queue when it
  // comes back (not on the first connection, which follows the initial load).
  const wasLive = useRef(false);
  const lastStatus = useRef(liveStatus);
  useEffect(() => {
    if (liveStatus === "live" && lastStatus.current !== "live" && wasLive.current) void loadQueue();
    if (liveStatus === "live") wasLive.current = true;
    lastStatus.current = liveStatus;
  }, [liveStatus, loadQueue]);

  function openReview(item: QueueItem, mode: ReviewMode) {
    setCategory(mode === "reassign" ? (item.suggestion?.category ?? null) : null);
    setReviewError(null);
    setCategoryError(null);
    setReview({ item, mode });
  }

  function openResolve(item: QueueItem) {
    setNote("");
    setResolveError(null);
    setResolving(item);
  }

  async function submitReview() {
    if (!review) return;
    const body = review.mode === "accept" ? { decision: "accept" } : { decision: review.mode, category };
    if (review.mode !== "accept" && !category) {
      setCategoryError("Choose a category.");
      return;
    }
    setCategoryError(null);
    setReviewError(null);
    setPending(true);
    try {
      await api.postRaw(`/api/staff/requests/${review.item.id}/review`, body);
      announce(`Request "${review.item.title}" assigned.`);
      // The row leaves the queue, so the result takes focus.
      banner.show({ text: `Assigned "${review.item.title}". It is now under In progress.`, link: { to: "/staff?tab=working", label: "Go to In progress" }, focus: true });
      setReview(null);
      setNotice(null);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setReview(null);
        setNotice(`Already reviewed: "${review.item.title}" was handled by someone else or cancelled. The queue has been refreshed.`);
      } else {
        setReviewError(SAVE_FAILED);
      }
    } finally {
      setPending(false);
      void load();
    }
  }

  /** Posts a status change: "ok", "conflict" (a 409, reported on the page) or "failed". */
  async function postStatus(item: QueueItem, status: "in_progress" | "resolved", noteText?: string): Promise<"ok" | "conflict" | "failed"> {
    try {
      await api.postRaw(`/api/staff/requests/${item.id}/status`, noteText ? { status, note: noteText } : { status });
      announce(`"${item.title}" is now ${statusLabel(status).toLowerCase()}.`);
      setNotice(null);
      void load();
      return "ok";
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        setNotice(`"${item.title}" changed meanwhile. The list has been refreshed.`);
        void load();
        return "conflict";
      }
      return "failed";
    }
  }

  // The row's button is gone after the change, so the result takes focus. It is shown in
  // the same update that closes a dialog, so it runs after the dialog's focus restore.
  const showStatus = (item: QueueItem, status: "in_progress" | "resolved") =>
    banner.show({ text: `"${item.title}" is now ${statusLabel(status)}.`, focus: true });

  async function startWork(item: QueueItem) {
    const outcome = await postStatus(item, "in_progress");
    if (outcome === "ok") showStatus(item, "in_progress");
    if (outcome === "failed") setNotice(SAVE_FAILED);
  }

  async function submitResolve() {
    if (!resolving) return;
    const item = resolving;
    setResolvePending(true);
    setResolveError(null);
    const outcome = await postStatus(item, "resolved", note.trim() || undefined);
    setResolvePending(false);
    if (outcome === "failed") {
      setResolveError(SAVE_FAILED);
      return;
    }
    setResolving(null);
    if (outcome === "ok") showStatus(item, "resolved");
  }

  const base = [
    {
      key: "title",
      header: "Request",
      render: (r: QueueItem) => (
        <Link to={`/requests/${r.id}`} state={{ from: tab === "queue" ? "/staff" : `/staff?tab=${tab}` }}>
          {r.title}
        </Link>
      ),
    },
    { key: "where", header: "Where", render: (r: QueueItem) => r.resourceName ?? (r.locationNote || "Not given") },
    { key: "age", header: "Age", render: (r: QueueItem) => age(r.ageMinutes), sortValue: (r: QueueItem) => r.ageMinutes },
  ];
  const queueColumns = [
    ...base,
    {
      key: "suggestion",
      header: "Suggestion",
      // A suggestion that arrived after the sweep handed the request to staff is stored
      // but not shown: categorizing such a row records "manual", which means no
      // suggestion was shown (SPEC 6.1).
      render: (r: QueueItem) =>
        r.suggestion && r.triageState === "suggested" ? (
          <span>
            {categoryLabel(r.suggestion.category)}, {Math.round(r.suggestion.confidence * 100)}% confidence
            <br />
            <span className={styles.pill}>{providerLabel(r.suggestion.provider)}</span>
          </span>
        ) : r.triageState === "unavailable" ? (
          "Automatic classification unavailable"
        ) : (
          "Classification pending"
        ),
    },
  ];
  const workColumns = [...base, { key: "status", header: "Status", render: (r: QueueItem) => statusLabel(r.status) }, { key: "category", header: "Category", render: (r: QueueItem) => categoryLabel(r.finalCategory) }];

  return (
    <section className={styles.stack}>
      <div className={styles.row}>
        <h1>Facilities staff</h1>
        <span className={styles.status} role="status">
          <span className={`${styles.dot} ${liveStatus === "live" ? styles.dotLive : ""}`} aria-hidden="true" />
          {liveStatus === "live" ? "Live updates on" : liveStatus === "connecting" ? "Connecting to live updates" : "Live updates offline, retrying"}
        </span>
        {updatedAt ? <span className={`${styles.muted} ${styles.status}`}>Updated {hhmm(updatedAt)}</span> : null}
      </div>
      {error ? (
        <LoadError
          message={error}
          onRetry={() => {
            setError(null);
            return load();
          }}
        />
      ) : null}
      {notice ? (
        <p role="alert" className={styles.notice}>
          {notice}
        </p>
      ) : null}
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Staff views">
        {(id) =>
          id === "queue" ? (
            <DataTable
              caption="Triage queue"
              columns={queueColumns}
              rows={queue ?? []}
              rowKey={(r) => r.id}
              empty={queue === null ? "Loading…" : "Nothing waiting for review."}
              rowActions={(r) =>
                r.suggestion && r.triageState === "suggested" ? (
                  <>
                    <Button size="sm" onClick={() => openReview(r, "accept")}>
                      Accept{" "}<span className="visually-hidden">suggestion for {r.title}</span>
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => openReview(r, "reassign")}>
                      Reassign{" "}<span className="visually-hidden">{r.title}</span>
                    </Button>
                  </>
                ) : (
                  <Button size="sm" onClick={() => openReview(r, "categorize")}>
                    Categorize{" "}<span className="visually-hidden">{r.title}</span>
                  </Button>
                )
              }
            />
          ) : id === "working" ? (
            <DataTable
              caption="Assigned and in progress"
              columns={workColumns}
              rows={working}
              rowKey={(r) => r.id}
              empty="No work in progress."
              rowActions={(r) => (
                <>
                  {r.status === "assigned" ? (
                    <Button size="sm" variant="secondary" onClick={() => void startWork(r)}>
                      Start work{" "}<span className="visually-hidden">on {r.title}</span>
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={() => openResolve(r)}>
                    Resolve{" "}<span className="visually-hidden">{r.title}</span>
                  </Button>
                </>
              )}
            />
          ) : id === "resolved" ? (
            <DataTable caption="Resolved" columns={workColumns} rows={resolved} rowKey={(r) => r.id} empty="Nothing resolved yet." />
          ) : todayError ? (
            <LoadError
              message={todayError}
              onRetry={() => {
                setTodayError(null);
                setToday(null);
                setTodayTick((t) => t + 1);
              }}
            />
          ) : (
            <DataTable
              caption={`Bookings today, ${site.today}`}
              columns={[
                { key: "time", header: "Time", render: (b: Booking) => timeRange(b.startMin, b.endMin) },
                { key: "space", header: "Space", render: (b: Booking) => b.resourceName },
                { key: "who", header: "Booked by", render: (b: Booking) => b.employeeName },
                { key: "details", header: "Details", render: (b: Booking) => (b.kind === "room" ? `${b.attendees} attending${b.title ? `, ${b.title}` : ""}` : "Desk") },
              ]}
              rows={today ?? []}
              rowKey={(b) => b.id}
              empty={today === null ? "Loading…" : "No bookings today."}
            />
          )
        }
      </Tabs>
      <Dialog
        open={review !== null}
        onClose={() => setReview(null)}
        dismissable={!pending}
        title={review?.mode === "accept" ? "Accept the suggestion?" : review?.mode === "reassign" ? "Reassign the category" : "Categorize the request"}
        actions={
          <>
            <Button variant="secondary" onClick={() => setReview(null)} disabled={pending}>
              Cancel
            </Button>
            <Button onClick={() => void submitReview()} loading={pending}>
              {review?.mode === "accept" ? "Accept" : "Save category"}
            </Button>
          </>
        }
      >
        {review ? (
          <>
            <p>
              <strong>{review.item.title}</strong>
            </p>
            <p>{review.item.description}</p>
            {review.item.suggestion && review.item.triageState === "suggested" ? (
              <p>
                Suggested: {categoryLabel(review.item.suggestion.category)} ({providerLabel(review.item.suggestion.provider)}). {review.item.suggestion.rationale}
              </p>
            ) : null}
            {review.mode !== "accept" ? <Combobox label="Category" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} error={categoryError} /> : null}
            {reviewError ? (
              <p role="alert" className={styles.notice}>
                {reviewError}
              </p>
            ) : null}
          </>
        ) : null}
      </Dialog>
      <Dialog
        open={resolving !== null}
        onClose={() => setResolving(null)}
        dismissable={!resolvePending}
        title="Resolve this request?"
        actions={
          <>
            <Button variant="secondary" onClick={() => setResolving(null)} disabled={resolvePending}>
              Cancel
            </Button>
            <Button onClick={() => void submitResolve()} loading={resolvePending}>
              Resolve
            </Button>
          </>
        }
      >
        {resolving ? (
          <>
            <p>
              <strong>{resolving.title}</strong>
            </p>
            <p className={styles.muted}>A resolved request cannot be reopened. The reporter sees the note in the request's timeline.</p>
            <TextField label="Note for the reporter (optional)" value={note} onChange={setNote} multiline rows={3} maxLength={NOTE_MAX} />
            {resolveError ? (
              <p role="alert" className={styles.notice}>
                {resolveError}
              </p>
            ) : null}
          </>
        ) : null}
      </Dialog>
    </section>
  );
}
