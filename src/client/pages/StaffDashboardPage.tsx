// Facilities staff dashboard (SPEC 14.1): the triage queue with suggestions and their
// provider labels, accept, reassign or categorize in a Dialog, work in progress and
// resolved requests, and live staff events.
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { StaffQueueResponse } from "../../shared/api.ts";
import { CATEGORIES } from "../../shared/triage/categories.ts";
import { providerLabel } from "../../shared/triage/provider-labels.ts";
import { ApiClientError, api } from "../api/client.ts";
import { useStaffEvents } from "../live/useStaffEvents.ts";
import { useAnnounce } from "../shell/Announcer.tsx";
import { Button } from "../ui/Button.tsx";
import { Combobox } from "../ui/Combobox.tsx";
import { DataTable } from "../ui/DataTable.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import styles from "./pages.module.css";
import { categoryLabel, statusLabel } from "./requests-ui.ts";
import { useSite } from "./site.ts";
import { usePageTitle } from "./usePageTitle.ts";

type QueueItem = StaffQueueResponse["requests"][number];
type ReviewMode = "accept" | "reassign" | "categorize";

const TABS = [
  { id: "queue", label: "Triage queue" },
  { id: "working", label: "In progress" },
  { id: "resolved", label: "Resolved" },
];
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
  const [tab, setTab] = useState("queue");
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  const [working, setWorking] = useState<QueueItem[]>([]);
  const [resolved, setResolved] = useState<QueueItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ item: QueueItem; mode: ReviewMode } | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
      setError(null);
    } catch {
      setError("The queue could not be loaded.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const liveStatus = useStaffEvents(site.siteId, (e) => {
    if (e.event === "triage_ready") announce("A new request is ready for review.");
    if (e.event === "triage_unavailable") announce("A request needs manual categorization.");
    if (e.event === "triage_overdue") announce("A review is overdue.");
    void load();
  });

  function openReview(item: QueueItem, mode: ReviewMode) {
    setCategory(mode === "reassign" ? (item.suggestion?.category ?? null) : null);
    setReviewError(null);
    setReview({ item, mode });
  }

  async function submitReview() {
    if (!review) return;
    const body = review.mode === "accept" ? { decision: "accept" } : { decision: review.mode, category };
    if (review.mode !== "accept" && !category) {
      setReviewError("Choose a category.");
      return;
    }
    setPending(true);
    try {
      await api.postRaw(`/api/staff/requests/${review.item.id}/review`, body);
      announce(`Request "${review.item.title}" assigned.`);
      setReview(null);
      setNotice(null);
    } catch (err) {
      if (err instanceof ApiClientError && err.code === "not_reviewable") {
        setReview(null);
        setNotice(`Already reviewed: "${review.item.title}" was handled by someone else or cancelled. The queue has been refreshed.`);
      } else {
        setReviewError("The review could not be saved.");
      }
    } finally {
      setPending(false);
      void load();
    }
  }

  async function changeStatus(item: QueueItem, status: "in_progress" | "resolved") {
    try {
      await api.postRaw(`/api/staff/requests/${item.id}/status`, { status });
      announce(`"${item.title}" is now ${statusLabel(status).toLowerCase()}.`);
    } catch {
      setNotice(`"${item.title}" changed meanwhile. The list has been refreshed.`);
    }
    void load();
  }

  const base = [
    { key: "title", header: "Request", render: (r: QueueItem) => <Link to={`/requests/${r.id}`}>{r.title}</Link> },
    { key: "where", header: "Where", render: (r: QueueItem) => r.resourceName ?? (r.locationNote || "Not given") },
    { key: "age", header: "Age", render: (r: QueueItem) => age(r.ageMinutes) },
  ];
  const queueColumns = [
    ...base,
    {
      key: "suggestion",
      header: "Suggestion",
      render: (r: QueueItem) =>
        r.suggestion ? (
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
          {liveStatus === "live" ? "Live updates on" : "Live updates offline"}
        </span>
      </div>
      {error ? <p role="alert">{error}</p> : null}
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
                    <Button size="sm" variant="secondary" onClick={() => void changeStatus(r, "in_progress")}>
                      Start work{" "}<span className="visually-hidden">on {r.title}</span>
                    </Button>
                  ) : null}
                  <Button size="sm" onClick={() => void changeStatus(r, "resolved")}>
                    Resolve{" "}<span className="visually-hidden">{r.title}</span>
                  </Button>
                </>
              )}
            />
          ) : (
            <DataTable caption="Resolved" columns={workColumns} rows={resolved} rowKey={(r) => r.id} empty="Nothing resolved yet." />
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
            {review.item.suggestion ? (
              <p>
                Suggested: {categoryLabel(review.item.suggestion.category)} ({providerLabel(review.item.suggestion.provider)}). {review.item.suggestion.rationale}
              </p>
            ) : null}
            {review.mode !== "accept" ? <Combobox label="Category" options={CATEGORY_OPTIONS} value={category} onChange={setCategory} error={reviewError} /> : null}
            {review.mode === "accept" && reviewError ? <p role="alert">{reviewError}</p> : null}
          </>
        ) : null}
      </Dialog>
    </section>
  );
}
