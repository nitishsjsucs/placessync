// Facilities admin dashboard (SPEC 14.1): utilization from the D1 reporting views and
// the request report, where suggestion agreement is shown per provider with that
// provider's own label. Nothing aggregates across providers.
//
// The Utilization tab opens on whether the reports include the latest bookings (the
// projection status), four figures and a bookings-per-day chart, then one table per kind
// with every space on a fixed 0 to 100% scale, held (past days) apart from booked ahead
// (charts/held-ahead.ts). Show daily rows brings back the per-day rows; the long tables
// fold behind Show table. The range has date inputs and presets and scopes everything.
// Deactivating a space asks first and says how many upcoming bookings reports show for
// it; a failed toggle is shown on the page.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { ProjectionStatusResponse, RequestsReport, type Resource, ResourcePatchResponse, ResourcesResponse, UtilizationReport } from "../../shared/api.ts";
import { DATE_RE, addDays, dayOfWeek, isValidDate } from "../../shared/time.ts";
import { PROVIDER_LABELS, type SuggestionProvider } from "../../shared/triage/provider-labels.ts";
import { ApiClientError, api, qs } from "../api/client.ts";
import { DailyColumns, monthDay } from "../charts/DailyColumns.tsx";
import { FixedBar } from "../charts/FixedBar.tsx";
import { Freshness } from "../charts/Freshness.tsx";
import { KeptMatrix, ShareLegend } from "../charts/KeptMatrix.tsx";
import { ReviewBuckets } from "../charts/ReviewBuckets.tsx";
import { matrices } from "../charts/kept-matrix.ts";
import { StatTiles } from "../charts/StatTiles.tsx";
import chartStyles from "../charts/charts.module.css";
import { type SpaceUse, percent, splitAtToday, weekdaysBetween } from "../charts/held-ahead.ts";
import { useAnnounce } from "../shell/Announcer.tsx";
import { LoadError } from "../shell/LoadError.tsx";
import { useStatusBanner } from "../shell/StatusBanner.tsx";
import { Button } from "../ui/Button.tsx";
import { DataTable } from "../ui/DataTable.tsx";
import { longDate } from "../ui/DateGrid.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import { TextField } from "../ui/TextField.tsx";
import styles from "./pages.module.css";
import { categoryLabel, statusLabel } from "./requests-ui.ts";
import { useSite } from "./site.ts";
import { usePageTitle } from "./usePageTitle.ts";

type UtilizationRow = UtilizationReport["rows"][number];
type DailyRow = UtilizationReport["daily"][number];
interface HourRow {
  hour: number;
  desk: number;
  room: number;
}

/** Bookings overlapping each hour (v_hourly_occupancy), averaged over the days in range that have any booking. */
export function hourlyAverages(report: UtilizationReport): HourRow[] {
  const days = new Set(report.daily.map((d) => d.date)).size || 1;
  const out: HourRow[] = [];
  for (let hour = 7; hour < 19; hour++) {
    const sum = (kind: string) => report.hourly.filter((h) => h.hour === hour && h.resourceKind === kind).reduce((n, h) => n + h.occupied, 0);
    out.push({ hour, desk: Math.round((sum("desk") / days) * 10) / 10, room: Math.round((sum("room") / days) * 10) / 10 });
  }
  return out;
}

/** "13 h 4 min", "13 h" or "42 min". */
export function formatDuration(minutes: number): string {
  const total = Math.round(minutes);
  if (total < 60) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

type AgreementRow = RequestsReport["agreement"][number];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Tuesday, October 20". */
const dayAndDate = (date: string) => `${WEEKDAYS[dayOfWeek(date)]}, ${monthDay(date)}`;

/** What the Deactivate dialog found in the reports for the space, from today on. */
type Upcoming = { status: "loading" } | { status: "ok"; count: number; next: string | null } | { status: "error" };

const TABS = [
  { id: "utilization", label: "Utilization" },
  { id: "requests", label: "Requests" },
  { id: "resources", label: "Resources" },
];

/** "Keyword stub agreement", "Workers AI agreement" and so on: one label per provider. */
export function agreementLabel(provider: string): string {
  const name = PROVIDER_LABELS[provider as SuggestionProvider] ?? provider;
  return `${name} agreement`;
}

const SAVE_FAILED = "Could not save. Check your connection and try again.";
const CAPACITY_MESSAGE = "Enter a whole number from 1 to 50.";
const isDate = (d: string) => DATE_RE.test(d) && isValidDate(d);

export function AdminDashboardPage() {
  usePageTitle("Facilities admin");
  const site = useSite();
  const [tab, setTab] = useState("utilization");
  const [from, setFrom] = useState(addDays(site.today, -28));
  const [to, setTo] = useState(addDays(site.today, site.rules.horizonDays));
  const [range, setRange] = useState({ from, to });
  const [util, setUtil] = useState<UtilizationReport | null>(null);
  const [reqs, setReqs] = useState<RequestsReport | null>(null);
  // Whether the reports include the latest bookings; null hides the line.
  const [status, setStatus] = useState<ProjectionStatusResponse | null>(null);
  // A refetch (new range, preset, Refresh) keeps the last render, dimmed.
  const [reloading, setReloading] = useState(false);
  const [showHourly, setShowHourly] = useState(false);
  const hourlyId = useId();
  const hourlyHeadingId = useId();
  const spacesHeadingId = useId();
  const keptHeadingId = useId();
  const [upcoming, setUpcoming] = useState<Upcoming | null>(null);
  const upcomingSeq = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [daily, setDaily] = useState(false);
  const announce = useAnnounce();
  const banner = useStatusBanner();
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [editing, setEditing] = useState<Resource | null>(null);
  const [capacity, setCapacity] = useState("");
  const [description, setDescription] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deactivating, setDeactivating] = useState<Resource | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);
  const keepRef = useRef<HTMLButtonElement>(null);

  const loadResources = useCallback(async () => {
    try {
      setResources((await api.get(`/api/sites/${site.siteId}/resources?includeInactive=1`, ResourcesResponse)).resources);
      setResourcesError(null);
    } catch {
      setResourcesError("Resources could not be loaded.");
    }
  }, [site.siteId]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  /** A refusal the server explains (4xx) keeps its message; anything else says to check the connection. */
  const failure = (err: unknown) => (err instanceof ApiClientError && err.status < 500 ? (Object.values(err.fieldErrors())[0] ?? err.message) : SAVE_FAILED);

  async function setActive(r: Resource, active: boolean) {
    setToggling(true);
    setToggleError(null);
    const done = `${r.name} is now ${active ? "bookable" : "inactive"}.`;
    try {
      await api.patch(`/api/admin/resources/${r.id}`, { active }, ResourcePatchResponse);
      announce(done);
      banner.show({ text: done });
      setDeactivating(null);
      await loadResources();
    } catch (err) {
      setDeactivating(null);
      setToggleError(failure(err));
    } finally {
      setToggling(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    let body: Record<string, unknown> = { description };
    if (editing.kind === "room") {
      const n = Number(capacity);
      if (!/^\d+$/.test(capacity.trim()) || !Number.isInteger(n) || n < 1 || n > 50) {
        setEditError(CAPACITY_MESSAGE);
        return;
      }
      body = { ...body, capacity: n };
    }
    setSaving(true);
    setEditError(null);
    try {
      await api.patch(`/api/admin/resources/${editing.id}`, body, ResourcePatchResponse);
      const done = `${editing.name} updated.`;
      announce(done);
      banner.show({ text: done });
      setEditing(null);
      await loadResources();
    } catch (err) {
      const capacityIssue = err instanceof ApiClientError && err.status === 422 && err.fieldErrors().capacity;
      setEditError(capacityIssue ? CAPACITY_MESSAGE : failure(err));
    } finally {
      setSaving(false);
    }
  }

  const load = useCallback(async () => {
    setReloading(true);
    const q = qs(range);
    // Fetched beside the reports; if it fails, only the freshness line goes.
    const statusRequest = api.get("/api/admin/projection/status", ProjectionStatusResponse).catch(() => null);
    try {
      const [u, r, st] = await Promise.all([
        api.get(`/api/admin/reports/utilization${q}`, UtilizationReport),
        api.get(`/api/admin/reports/requests${q}`, RequestsReport),
        statusRequest,
      ]);
      setUtil(u);
      setReqs(r);
      setStatus(st);
      setError(null);
    } catch {
      setError("Reports could not be loaded.");
    } finally {
      setReloading(false);
    }
  }, [range]);

  // The Deactivate dialog says what reports show from today on for that space: one report
  // for today through the booking horizon, narrowed to the space's kind.
  useEffect(() => {
    if (!deactivating) {
      setUpcoming(null);
      return;
    }
    const seq = ++upcomingSeq.current;
    setUpcoming({ status: "loading" });
    const query = qs({ from: site.today, to: addDays(site.today, site.rules.horizonDays), kind: deactivating.kind });
    api
      .get(`/api/admin/reports/utilization${query}`, UtilizationReport)
      .then((r) => {
        if (seq !== upcomingSeq.current) return;
        const days = r.rows.filter((row) => row.resourceId === deactivating.id && row.bookings > 0);
        setUpcoming({ status: "ok", count: days.reduce((n, d) => n + d.bookings, 0), next: days.map((d) => d.date).sort()[0] ?? null });
      })
      .catch(() => {
        if (seq === upcomingSeq.current) setUpcoming({ status: "error" });
      });
  }, [deactivating, site.today, site.rules.horizonDays]);

  useEffect(() => {
    void load();
  }, [load]);

  function apply(nextFrom: string, nextTo: string) {
    if (!isDate(nextFrom)) return setRangeError("From must be a date.");
    if (!isDate(nextTo)) return setRangeError("To must be a date.");
    if (nextFrom > nextTo) return setRangeError("To must be on or after From.");
    setRangeError(null);
    setRange({ from: nextFrom, to: nextTo });
  }

  const presets = [
    { label: "Last 7 days", from: addDays(site.today, -6), to: site.today },
    { label: "Last 4 weeks", from: addDays(site.today, -27), to: site.today },
    { label: site.rules.horizonDays === 14 ? "Next 2 weeks" : `Next ${site.rules.horizonDays} days`, from: site.today, to: addDays(site.today, site.rules.horizonDays) },
  ];

  const split = util && resources ? splitAtToday(util, resources, site.today, range) : null;
  const hours = util ? hourlyAverages(util) : [];
  const hourMax = Math.max(1, ...hours.flatMap((h) => [h.desk, h.room]));
  const bar = (value: number, top: number) => (
    <span className={styles.barCell}>
      <span className={styles.barTrack} aria-hidden="true">
        <span className={styles.bar} style={{ width: `${Math.round((value / top) * 100)}%` }} />
      </span>
      {value}
    </span>
  );
  // Daily rows use the same fixed 0 to 100% scale as the per-space tables.
  const percentBar = (value: number) => <FixedBar value={value} />;

  const spaceTable = (kind: "desk" | "room") => {
    if (!split) return null;
    const k = split.kinds[kind];
    const average = !split.held || split.held.weekdays === 0 ? "no past days" : k.heldUtilization === null ? "none bookable now" : `average held ${percent(k.heldUtilization)}`;
    const noHeld = !split.held || split.held.weekdays === 0;
    const noAhead = !split.ahead || split.ahead.weekdays === 0;
    return (
      <DataTable
        caption={`${kind === "desk" ? "Desks" : "Rooms"}: utilization by space, ${longDate(range.from)} to ${longDate(range.to)} (${average})`}
        columns={[
          {
            key: "name",
            header: "Space",
            sortValue: (s: SpaceUse) => s.name,
            render: (s: SpaceUse) => (
              <>
                <Link to={`/resources/${s.id}`}>{s.name}</Link>
                {s.active ? null : " (inactive)"}
              </>
            ),
          },
          {
            key: "held",
            header: "Held",
            sortValue: (s: SpaceUse) => s.held.utilization ?? -1,
            render: (s: SpaceUse) => (noHeld ? "No past days" : s.held.bookedMin === 0 ? "Not booked" : <FixedBar value={s.held.utilization ?? 0} />),
          },
          {
            key: "ahead",
            header: "Booked ahead",
            sortValue: (s: SpaceUse) => s.ahead.utilization ?? -1,
            render: (s: SpaceUse) => (noAhead ? "No days ahead" : s.ahead.bookedMin === 0 ? "Not booked" : <FixedBar value={s.ahead.utilization ?? 0} tone="context" />),
          },
          { key: "bookings", header: "Bookings", sortValue: (s: SpaceUse) => s.bookings, render: (s: SpaceUse) => s.bookings },
          { key: "days", header: "Days booked", sortValue: (s: SpaceUse) => s.days, render: (s: SpaceUse) => s.days },
        ]}
        rows={split.spaces.filter((s) => s.kind === kind)}
        rowKey={(s) => s.id}
        defaultSort={{ key: "held", direction: "descending" }}
        empty={`No ${kind === "desk" ? "desks" : "rooms"} in this range.`}
      />
    );
  };

  // One matrix per provider, in the agreement table's order; never merged (SPEC 6.1).
  const keptMatrices = reqs?.kept ? matrices(reqs.kept, reqs.agreement.map((a) => a.provider)) : [];
  const medianSentence = `Median time to review: ${reqs?.medianMinutesToReview == null ? "no reviews yet" : formatDuration(reqs.medianMinutesToReview)} (${reqs?.reviewedCount ?? 0} reviewed).`;

  const upcomingText = (r: Resource): string => {
    if (!upcoming || upcoming.status === "loading") return "Checking upcoming bookings…";
    if (upcoming.status === "error") return "Upcoming bookings could not be checked.";
    if (upcoming.count === 0) return `Reports show no bookings for ${r.name} from today on.`;
    // Reports count by date, and today's may include bookings that already ended, so the
    // sentence names the first date ("the first on"), marked "(today)" when it is today.
    const first = upcoming.next ? `${dayAndDate(upcoming.next)}${upcoming.next === site.today ? " (today)" : ""}` : null;
    if (upcoming.count === 1) return `Reports show 1 booking for ${r.name} from today on${first ? `, on ${first}` : ""}. It stays booked, and My bookings marks the space (not bookable now).`;
    return `Reports show ${upcoming.count} bookings for ${r.name} from today on${first ? `, the first on ${first}` : ""}. They stay booked, and My bookings marks the space (not bookable now).`;
  };

  return (
    <section className={styles.stack}>
      <h1>Facilities admin</h1>
      <form
        className={styles.stack}
        aria-label="Report range"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          apply(from, to);
        }}
      >
        <div className={styles.toolbar}>
          <TextField label="From" type="date" value={from} onChange={setFrom} />
          <TextField label="To" type="date" value={to} onChange={setTo} />
          <Button type="submit" variant="secondary">
            Apply range
          </Button>
        </div>
        <div className={styles.row}>
          <span className={styles.muted}>Quick ranges:</span>
          {presets.map((p) => (
            <Button
              key={p.label}
              variant="secondary"
              size="sm"
              onClick={() => {
                setFrom(p.from);
                setTo(p.to);
                apply(p.from, p.to);
              }}
            >
              {p.label}
            </Button>
          ))}
        </div>
        {rangeError ? (
          <p role="alert" className={styles.notice}>
            {rangeError}
          </p>
        ) : null}
      </form>
      {toggleError ? (
        <p role="alert" className={styles.notice}>
          {toggleError}
        </p>
      ) : null}
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Reports">
        {(id) =>
          error && id !== "resources" ? (
            <LoadError
              message={error}
              onRetry={() => {
                setError(null);
                return load();
              }}
            />
          ) : resourcesError && id === "resources" ? (
            <LoadError
              message={resourcesError}
              onRetry={() => {
                setResourcesError(null);
                return loadResources();
              }}
            />
          ) : id === "utilization" ? (
            <div className={styles.stack}>
              <Freshness status={status} timeZone={site.rules.timezone} today={site.today} onRefresh={() => void load()} refreshing={reloading} />
              {util === null ? (
                <p role="status">Loading the reports…</p>
              ) : (
                <>
                  <div className={reloading ? chartStyles.refreshing : undefined} aria-busy={reloading || undefined}>
                    {resourcesError ? (
                      <LoadError
                        message={resourcesError}
                        onRetry={() => {
                          setResourcesError(null);
                          return loadResources();
                        }}
                      />
                    ) : split ? (
                      <StatTiles split={split} today={site.today} />
                    ) : (
                      <p role="status">Loading spaces…</p>
                    )}
                  </div>
                  <DailyColumns report={util} range={range} today={site.today} refreshing={reloading} />
                  <section className={`${chartStyles.section} ${reloading ? chartStyles.refreshing : ""}`} aria-labelledby={spacesHeadingId}>
                    <div className={chartStyles.sectionHead}>
                      <h2 id={spacesHeadingId}>Utilization by space</h2>
                      <Button variant="secondary" size="sm" aria-pressed={daily} onClick={() => setDaily((d) => !d)}>
                        Show daily rows
                      </Button>
                    </div>
                    {daily ? (
                      <DataTable
                        caption={`Utilization, ${longDate(range.from)} to ${longDate(range.to)}`}
                        columns={[
                          { key: "name", header: "Space", render: (r: UtilizationRow) => r.name, sortValue: (r: UtilizationRow) => r.name },
                          { key: "date", header: "Date", render: (r: UtilizationRow) => r.date, sortValue: (r: UtilizationRow) => r.date },
                          { key: "bookings", header: "Bookings", render: (r: UtilizationRow) => r.bookings },
                          { key: "hours", header: "Booked hours", render: (r: UtilizationRow) => (r.bookedMin / 60).toFixed(1) },
                          { key: "utilization", header: "Utilization", sortValue: (r: UtilizationRow) => r.utilization, render: (r: UtilizationRow) => percentBar(r.utilization) },
                        ]}
                        rows={util.rows}
                        rowKey={(r) => `${r.resourceId}-${r.date}`}
                        empty="No confirmed bookings in this range yet."
                      />
                    ) : split ? (
                      <>
                        {spaceTable("desk")}
                        {spaceTable("room")}
                      </>
                    ) : null}
                    <p className={styles.muted}>
                      Held is booked hours over every bookable hour of the {split?.held?.weekdays ?? 0} weekdays before today in the range; booked ahead is the same for the{" "}
                      {split?.ahead?.weekdays ?? 0} weekdays {!split?.ahead || split.ahead.from === site.today ? "from today on" : `from ${longDate(split.ahead.from)} on`}, with the bookings
                      made so far. Both are on a fixed 0 to 100% scale.
                    </p>
                  </section>
                  <section className={`${chartStyles.section} ${reloading ? chartStyles.refreshing : ""}`} aria-labelledby={hourlyHeadingId}>
                    <div className={chartStyles.sectionHead}>
                      <h2 id={hourlyHeadingId}>Bookings by hour</h2>
                      <Button variant="secondary" size="sm" aria-expanded={showHourly} aria-controls={hourlyId} onClick={() => setShowHourly((v) => !v)}>
                        Show table<span className="visually-hidden">: bookings by hour</span>
                      </Button>
                    </div>
                    <div id={hourlyId} hidden={!showHourly}>
                      {showHourly ? (
                        <DataTable
                          caption="Bookings overlapping each hour, averaged over days with any booking in the range"
                          columns={[
                            { key: "hour", header: "Hour", render: (r: HourRow) => `${String(r.hour).padStart(2, "0")}:00` },
                            { key: "desk", header: "Desk bookings", render: (r: HourRow) => bar(r.desk, hourMax) },
                            { key: "room", header: "Room bookings", render: (r: HourRow) => bar(r.room, hourMax) },
                          ]}
                          rows={util.daily.length > 0 ? hours : []}
                          rowKey={(r) => String(r.hour)}
                          empty="No bookings in this range yet."
                          stacked={false}
                        />
                      ) : null}
                    </div>
                  </section>
                </>
              )}
            </div>
          ) : id === "resources" ? (
            <DataTable
              caption="Resources"
              columns={[
                { key: "name", header: "Space", render: (r: Resource) => r.name },
                { key: "kind", header: "Kind", render: (r: Resource) => (r.kind === "desk" ? "Desk" : "Room") },
                { key: "where", header: "Location", render: (r: Resource) => `Floor ${r.floor}, ${r.zone}` },
                { key: "capacity", header: "Capacity", render: (r: Resource) => r.capacity },
                { key: "status", header: "Status", render: (r: Resource) => (r.active ? "Bookable" : "Inactive") },
              ]}
              rows={resources ?? []}
              rowKey={(r) => r.id}
              empty={resources === null ? "Loading…" : "No resources."}
              rowActions={(r) => (
                <>
                  <Button
                    size="sm"
                    variant={r.active ? "danger" : "secondary"}
                    onClick={() => {
                      setToggleError(null);
                      if (r.active) setDeactivating(r);
                      else void setActive(r, true);
                    }}
                  >
                    {r.active ? "Deactivate" : "Activate"} <span className="visually-hidden">{r.name}</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      setCapacity(String(r.capacity));
                      setDescription(r.description);
                      setEditError(null);
                      setEditing(r);
                    }}
                  >
                    Edit <span className="visually-hidden">{r.name}</span>
                  </Button>
                </>
              )}
            />
          ) : (
            <div className={`${styles.stack} ${reloading ? chartStyles.refreshing : ""}`} aria-busy={reloading || undefined}>
              <DataTable
                caption="Suggestion agreement by provider"
                columns={[
                  { key: "provider", header: "Provider", render: (r: AgreementRow) => agreementLabel(r.provider) },
                  { key: "reviewed", header: "Reviewed", render: (r: AgreementRow) => r.reviewed },
                  { key: "agreed", header: "Staff agreed", render: (r: AgreementRow) => r.agreed },
                  { key: "rate", header: "Agreement rate", render: (r: AgreementRow) => `${Math.round(r.agreementRate * 1000) / 10}%` },
                ]}
                rows={reqs?.agreement ?? []}
                rowKey={(r) => r.provider}
                empty="No reviewed suggestions in this range."
              />
              <p className={styles.muted}>Manual categorizations never saw a suggestion and are excluded from agreement.</p>
              {reqs?.kept ? (
                <section className={chartStyles.section} aria-labelledby={keptHeadingId}>
                  <h2 id={keptHeadingId}>Staff decisions on suggestions</h2>
                  <p className={styles.muted}>How often staff kept each provider's suggestion. Not an accuracy measure. Rows are the suggested category, columns the category staff chose.</p>
                  {keptMatrices.length === 0 ? (
                    <p className={styles.muted}>No reviewed suggestions in this range.</p>
                  ) : (
                    <>
                      <ShareLegend />
                      {keptMatrices.map((m) => (
                        <KeptMatrix key={m.provider} matrix={m} />
                      ))}
                    </>
                  )}
                </section>
              ) : null}
              {reqs?.reviewBuckets ? (
                <ReviewBuckets buckets={reqs.reviewBuckets} median={medianSentence} />
              ) : (
                <p>{medianSentence}</p>
              )}
              <DataTable
                caption="Requests by category and status"
                columns={[
                  { key: "category", header: "Category", render: (r: RequestsReport["categories"][number]) => (r.category === "(unreviewed)" ? "Not reviewed yet" : categoryLabel(r.category)) },
                  { key: "status", header: "Status", render: (r: RequestsReport["categories"][number]) => statusLabel(r.status) },
                  { key: "n", header: "Requests", render: (r: RequestsReport["categories"][number]) => r.n },
                ]}
                rows={reqs?.categories ?? []}
                rowKey={(r) => `${r.category}-${r.status}`}
                empty="No requests in this range."
              />
            </div>
          )
        }
      </Tabs>
      <Dialog
        open={deactivating !== null}
        onClose={() => setDeactivating(null)}
        dismissable={!toggling}
        title={`Deactivate ${deactivating?.name ?? ""}?`}
        initialFocus={keepRef}
        actions={
          <>
            <Button ref={keepRef} variant="secondary" onClick={() => setDeactivating(null)} disabled={toggling}>
              Keep active
            </Button>
            <Button variant="danger" loading={toggling} onClick={() => deactivating && void setActive(deactivating, false)}>
              Deactivate
            </Button>
          </>
        }
      >
        <p>Existing bookings are kept. Nobody can book it until it is activated again.</p>
        {deactivating ? <p role="status">{upcomingText(deactivating)}</p> : null}
      </Dialog>
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        dismissable={!saving}
        title={`Edit ${editing?.name ?? ""}`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button loading={saving} onClick={() => void saveEdit()}>
              Save
            </Button>
          </>
        }
      >
        {editing?.kind === "room" ? (
          <TextField label="Capacity" type="number" inputMode="numeric" value={capacity} onChange={setCapacity} hint="1 to 50 people." error={editError === CAPACITY_MESSAGE ? editError : null} />
        ) : null}
        <TextField label="Description" value={description} onChange={setDescription} multiline rows={3} maxLength={300} />
        {editError && editError !== CAPACITY_MESSAGE ? (
          <p role="alert" className={styles.notice}>
            {editError}
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}
