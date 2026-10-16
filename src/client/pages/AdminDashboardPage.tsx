// Facilities admin dashboard (SPEC 14.1): utilization from the D1 reporting views and
// the request report, where suggestion agreement is shown per provider with that
// provider's own label. Nothing aggregates across providers.
//
// Utilization shows one row per space by default, summed in the client from the
// report's per-day rows (Show daily rows brings those back). The range has date inputs
// and presets. Deactivating a space asks first; a failed toggle is shown on the page.
import { useCallback, useEffect, useRef, useState } from "react";
import { RequestsReport, type Resource, ResourcePatchResponse, ResourcesResponse, UtilizationReport } from "../../shared/api.ts";
import { DATE_RE, addDays, isValidDate, isWeekday } from "../../shared/time.ts";
import { PROVIDER_LABELS, type SuggestionProvider } from "../../shared/triage/provider-labels.ts";
import { ApiClientError, api, qs } from "../api/client.ts";
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

/** One row per space over the whole range. */
export interface SpaceRow {
  resourceId: string;
  name: string;
  kind: "desk" | "room";
  bookings: number;
  bookedMin: number;
  days: number;
  utilization: number;
}

/** Average resources in use per hour, over the days in range that have any booking. */
export function hourlyAverages(report: UtilizationReport): HourRow[] {
  const days = new Set(report.daily.map((d) => d.date)).size || 1;
  const out: HourRow[] = [];
  for (let hour = 7; hour < 19; hour++) {
    const sum = (kind: string) => report.hourly.filter((h) => h.hour === hour && h.resourceKind === kind).reduce((n, h) => n + h.occupied, 0);
    out.push({ hour, desk: Math.round((sum("desk") / days) * 10) / 10, room: Math.round((sum("room") / days) * 10) / 10 });
  }
  return out;
}

export function weekdaysBetween(from: string, to: string): number {
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) if (isWeekday(d)) n++;
  return n;
}

/** Sums the report's per-day rows per space; utilization is booked minutes over every open minute in the range. */
export function perSpace(report: UtilizationReport, from: string, to: string): SpaceRow[] {
  const open = weekdaysBetween(from, to) * report.totals.openMinutesPerDay;
  const bySpace = new Map<string, SpaceRow>();
  for (const r of report.rows) {
    const s = bySpace.get(r.resourceId) ?? { resourceId: r.resourceId, name: r.name, kind: r.kind, bookings: 0, bookedMin: 0, days: 0, utilization: 0 };
    s.bookings += r.bookings;
    s.bookedMin += r.bookedMin;
    s.days += 1;
    bySpace.set(r.resourceId, s);
  }
  return [...bySpace.values()].map((s) => ({ ...s, utilization: open > 0 ? s.bookedMin / open : 0 })).sort((a, b) => a.name.localeCompare(b.name));
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
    try {
      const q = qs(range);
      const [u, r] = await Promise.all([
        api.get(`/api/admin/reports/utilization${q}`, UtilizationReport),
        api.get(`/api/admin/reports/requests${q}`, RequestsReport),
      ]);
      setUtil(u);
      setReqs(r);
      setError(null);
    } catch {
      setError("Reports could not be loaded.");
    }
  }, [range]);

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

  const spaces = util ? perSpace(util, range.from, range.to) : [];
  const max = Math.max(1e-9, ...(daily ? (util?.rows ?? []).map((r) => r.utilization) : spaces.map((s) => s.utilization)));
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
  const percentBar = (value: number) => (
    <span className={styles.barCell}>
      <span className={styles.barTrack} aria-hidden="true">
        <span className={styles.bar} style={{ width: `${Math.round((value / max) * 100)}%` }} />
      </span>
      {Math.round(value * 100)}%
    </span>
  );

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
              {util ? (
                <p>
                  {util.totals.bookings} confirmed bookings, {Math.round(util.totals.bookedMin / 60)} booked hours across {util.totals.resourceDays} resource-days (each day
                  has {util.totals.openMinutesPerDay / 60} bookable hours).
                </p>
              ) : null}
              <div>
                <Button variant="secondary" aria-pressed={daily} onClick={() => setDaily((d) => !d)}>
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
                  rows={util?.rows ?? []}
                  rowKey={(r) => `${r.resourceId}-${r.date}`}
                  empty={util ? "No confirmed bookings in this range yet." : "Loading…"}
                />
              ) : (
                <DataTable
                  caption={`Utilization by space, ${longDate(range.from)} to ${longDate(range.to)}`}
                  columns={[
                    { key: "name", header: "Space", render: (r: SpaceRow) => r.name, sortValue: (r: SpaceRow) => r.name },
                    { key: "bookings", header: "Bookings", render: (r: SpaceRow) => r.bookings, sortValue: (r: SpaceRow) => r.bookings },
                    { key: "hours", header: "Booked hours", render: (r: SpaceRow) => (r.bookedMin / 60).toFixed(1) },
                    { key: "days", header: "Days booked", render: (r: SpaceRow) => r.days },
                    { key: "utilization", header: "Utilization", sortValue: (r: SpaceRow) => r.utilization, render: (r: SpaceRow) => percentBar(r.utilization) },
                  ]}
                  rows={spaces}
                  rowKey={(r) => r.resourceId}
                  empty={util ? "No confirmed bookings in this range yet." : "Loading…"}
                />
              )}
              {util && !daily ? (
                <p className={styles.muted}>
                  Utilization is booked hours over every bookable hour of the {weekdaysBetween(range.from, range.to)} weekdays in the range.
                </p>
              ) : null}
              <DataTable
                caption="Hourly occupancy: average desks and rooms in use"
                columns={[
                  { key: "hour", header: "Hour", render: (r: HourRow) => `${String(r.hour).padStart(2, "0")}:00` },
                  { key: "desk", header: "Desks in use", render: (r: HourRow) => bar(r.desk, hourMax) },
                  { key: "room", header: "Rooms in use", render: (r: HourRow) => bar(r.room, hourMax) },
                ]}
                rows={util && util.daily.length > 0 ? hours : []}
                rowKey={(r) => String(r.hour)}
                empty="No bookings in this range yet."
                stacked={false}
              />
              <DataTable
                caption="Bookings per day"
                columns={[
                  { key: "date", header: "Date", render: (r: DailyRow) => <span className={styles.nowrap}>{r.date}</span> },
                  { key: "kind", header: "Kind", render: (r: DailyRow) => (r.resourceKind === "desk" ? "Desks" : "Rooms") },
                  { key: "confirmed", header: "Confirmed", render: (r: DailyRow) => r.confirmed },
                  { key: "cancelled", header: "Cancelled", render: (r: DailyRow) => r.cancelled },
                ]}
                rows={util?.daily ?? []}
                rowKey={(r) => `${r.date}-${r.resourceKind}`}
                empty="No bookings in this range yet."
                stacked={false}
              />
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
            <div className={styles.stack}>
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
              <p>
                Median time to review: {reqs?.medianMinutesToReview == null ? "no reviews yet" : formatDuration(reqs.medianMinutesToReview)} ({reqs?.reviewedCount ?? 0} reviewed).
                Manual categorizations never saw a suggestion and are excluded from agreement.
              </p>
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
