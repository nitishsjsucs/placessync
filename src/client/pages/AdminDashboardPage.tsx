// Facilities admin dashboard (SPEC 14.1): utilization from the D1 reporting views and
// the request report, where suggestion agreement is shown per provider with that
// provider's own label. Nothing aggregates across providers.
import { useCallback, useEffect, useState } from "react";
import { RequestsReport, UtilizationReport } from "../../shared/api.ts";
import { addDays } from "../../shared/time.ts";
import { PROVIDER_LABELS, type SuggestionProvider } from "../../shared/triage/provider-labels.ts";
import { api, qs } from "../api/client.ts";
import { Button } from "../ui/Button.tsx";
import { DataTable } from "../ui/DataTable.tsx";
import { longDate } from "../ui/DateGrid.tsx";
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
type AgreementRow = RequestsReport["agreement"][number];

const TABS = [
  { id: "utilization", label: "Utilization" },
  { id: "requests", label: "Requests" },
];

/** "Keyword stub agreement", "Workers AI agreement" and so on: one label per provider. */
export function agreementLabel(provider: string): string {
  const name = PROVIDER_LABELS[provider as SuggestionProvider] ?? provider;
  return `${name} agreement`;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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
  const [rangeError, setRangeError] = useState<string | null>(null);

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

  const max = Math.max(1, ...(util?.rows ?? []).map((r) => r.utilization));
  const hours = util ? hourlyAverages(util) : [];
  const hourMax = Math.max(1, ...hours.flatMap((h) => [h.desk, h.room]));
  const bar = (value: number, top: number) => (
    <span className={styles.row}>
      <span className={styles.barTrack} aria-hidden="true">
        <span className={styles.bar} style={{ width: `${Math.round((value / top) * 100)}%` }} />
      </span>
      {value}
    </span>
  );

  return (
    <section className={styles.stack}>
      <h1>Facilities admin</h1>
      <form
        className={styles.toolbar}
        onSubmit={(e) => {
          e.preventDefault();
          if (!DATE_RE.test(from) || !DATE_RE.test(to) || from > to) {
            setRangeError("Use YYYY-MM-DD dates with From on or before To.");
            return;
          }
          setRangeError(null);
          setRange({ from, to });
        }}
      >
        <TextField label="From" value={from} onChange={setFrom} hint="YYYY-MM-DD" error={rangeError} />
        <TextField label="To" value={to} onChange={setTo} hint="YYYY-MM-DD" />
        <Button type="submit" variant="secondary">
          Apply range
        </Button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Reports">
        {(id) =>
          id === "utilization" ? (
            <div className={styles.stack}>
              {util ? (
                <p>
                  {util.totals.bookings} confirmed bookings, {Math.round(util.totals.bookedMin / 60)} booked hours across {util.totals.resourceDays} resource-days (each day
                  has {util.totals.openMinutesPerDay / 60} bookable hours).
                </p>
              ) : null}
              <DataTable
                caption={`Utilization, ${longDate(range.from)} to ${longDate(range.to)}`}
                columns={[
                  { key: "name", header: "Space", render: (r: UtilizationRow) => r.name },
                  { key: "date", header: "Date", render: (r: UtilizationRow) => r.date },
                  { key: "bookings", header: "Bookings", render: (r: UtilizationRow) => r.bookings },
                  { key: "hours", header: "Booked hours", render: (r: UtilizationRow) => (r.bookedMin / 60).toFixed(1) },
                  {
                    key: "utilization",
                    header: "Utilization",
                    render: (r: UtilizationRow) => (
                      <span className={styles.row}>
                        <span className={styles.barTrack} aria-hidden="true">
                          <span className={styles.bar} style={{ width: `${Math.round((r.utilization / max) * 100)}%` }} />
                        </span>
                        {Math.round(r.utilization * 100)}%
                      </span>
                    ),
                  },
                ]}
                rows={util?.rows ?? []}
                rowKey={(r) => `${r.resourceId}-${r.date}`}
                empty={util ? "No confirmed bookings in this range yet." : "Loading…"}
              />
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
              />
              <DataTable
                caption="Bookings per day"
                columns={[
                  { key: "date", header: "Date", render: (r: DailyRow) => r.date },
                  { key: "kind", header: "Kind", render: (r: DailyRow) => (r.resourceKind === "desk" ? "Desks" : "Rooms") },
                  { key: "confirmed", header: "Confirmed", render: (r: DailyRow) => r.confirmed },
                  { key: "cancelled", header: "Cancelled", render: (r: DailyRow) => r.cancelled },
                ]}
                rows={util?.daily ?? []}
                rowKey={(r) => `${r.date}-${r.resourceKind}`}
                empty="No bookings in this range yet."
              />
            </div>
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
                Median time to review: {reqs?.medianMinutesToReview == null ? "no reviews yet" : `${reqs.medianMinutesToReview} minutes`} ({reqs?.reviewedCount ?? 0} reviewed). Manual
                categorizations never saw a suggestion and are excluded from agreement.
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
    </section>
  );
}
