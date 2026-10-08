// My bookings (SPEC 14.1): Upcoming, Past and Cancelled tabs; cancel with an optional
// reason in a Dialog; a cancelled row moves to the Cancelled tab.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { type Reservation, ReservationsResponse, ReserveResponse, ResourcesResponse } from "../../shared/api.ts";
import { hasStarted } from "../../shared/rules.ts";
import { addDays } from "../../shared/time.ts";
import { ApiClientError, api, qs } from "../api/client.ts";
import { useAnnounce } from "../shell/Announcer.tsx";
import { Button } from "../ui/Button.tsx";
import { DataTable } from "../ui/DataTable.tsx";
import { longDate } from "../ui/DateGrid.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import { TextField } from "../ui/TextField.tsx";
import styles from "./pages.module.css";
import { timeRange, useSite } from "./site.ts";
import { usePageTitle } from "./usePageTitle.ts";

const TABS = [
  { id: "upcoming", label: "Upcoming" },
  { id: "past", label: "Past" },
  { id: "cancelled", label: "Cancelled" },
];

export function MyBookingsPage() {
  usePageTitle("My bookings");
  const site = useSite();
  const announce = useAnnounce();
  const [tab, setTab] = useState("upcoming");
  const [list, setList] = useState<Reservation[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<Reservation | null>(null);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  const load = useCallback(async () => {
    try {
      const from = addDays(site.today, -60);
      const to = addDays(site.today, site.rules.horizonDays);
      const [res, resources] = await Promise.all([
        api.get(`/api/reservations${qs({ from, to })}`, ReservationsResponse),
        api.get(`/api/sites/${site.siteId}/resources`, ResourcesResponse),
      ]);
      setList(res.reservations);
      setNames(new Map(resources.resources.map((r) => [r.id, r.name])));
      setError(null);
    } catch {
      setError("Your bookings could not be loaded.");
    }
  }, [site.today, site.rules.horizonDays, site.siteId]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo(() => {
    const now = Date.now();
    const out: Record<string, Reservation[]> = { upcoming: [], past: [], cancelled: [] };
    for (const r of list ?? []) {
      if (r.status === "cancelled") out.cancelled?.push(r);
      else if (hasStarted(r.date, r.startMin, site.rules, now)) out.past?.push(r);
      else out.upcoming?.push(r);
    }
    out.past?.reverse();
    return out;
  }, [list, site.rules]);

  async function confirmCancel() {
    if (!cancelling) return;
    setPending(true);
    setCancelError(null);
    try {
      await api.post(`/api/reservations/${cancelling.id}/cancel`, { reason: reason.trim() || undefined }, ReserveResponse);
      announce(`Cancelled ${names.get(cancelling.resourceId) ?? "the booking"} on ${longDate(cancelling.date)}.`);
      setCancelling(null);
      await load();
    } catch (err) {
      setCancelError(err instanceof ApiClientError ? err.message : "The booking could not be cancelled.");
    } finally {
      setPending(false);
    }
  }

  const columns = [
    { key: "space", header: "Space", render: (r: Reservation) => <Link to={`/resources/${r.resourceId}`}>{names.get(r.resourceId) ?? r.resourceId}</Link> },
    { key: "date", header: "Date", render: (r: Reservation) => longDate(r.date) },
    { key: "time", header: "Time", render: (r: Reservation) => timeRange(r.startMin, r.endMin) },
    { key: "details", header: "Details", render: (r: Reservation) => (r.kind === "room" ? `${r.attendees} attending${r.title ? `, ${r.title}` : ""}` : "Desk") },
  ];
  const cancelledColumns = [...columns, { key: "reason", header: "Reason", render: (r: Reservation) => r.cancelReason ?? "None given" }];

  return (
    <section className={styles.stack}>
      <h1>My bookings</h1>
      {error ? <p role="alert">{error}</p> : null}
      {list === null && !error ? <p role="status">Loading…</p> : null}
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Bookings">
        {(id) => (
          <DataTable
            caption={`${TABS.find((t) => t.id === id)?.label ?? ""} bookings`}
            columns={id === "cancelled" ? cancelledColumns : columns}
            rows={groups[id] ?? []}
            rowKey={(r) => r.id}
            empty={id === "upcoming" ? "No upcoming bookings. Find a space to book one." : "Nothing here."}
            rowActions={
              id === "upcoming"
                ? (r) => (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setReason("");
                        setCancelError(null);
                        setCancelling(r);
                      }}
                    >
                      Cancel booking{" "}
                      <span className="visually-hidden">
                        for {names.get(r.resourceId) ?? r.resourceId} on {longDate(r.date)}
                      </span>
                    </Button>
                  )
                : undefined
            }
          />
        )}
      </Tabs>
      <Dialog
        open={cancelling !== null}
        onClose={() => setCancelling(null)}
        title="Cancel this booking?"
        dismissable={!pending}
        initialFocus={keepRef}
        actions={
          <>
            <Button ref={keepRef} variant="secondary" onClick={() => setCancelling(null)} disabled={pending}>
              Keep booking
            </Button>
            <Button variant="danger" onClick={() => void confirmCancel()} loading={pending}>
              Cancel booking
            </Button>
          </>
        }
      >
        {cancelling ? (
          <p>
            {names.get(cancelling.resourceId) ?? cancelling.resourceId}, {longDate(cancelling.date)}, {timeRange(cancelling.startMin, cancelling.endMin)}.
          </p>
        ) : null}
        <TextField label="Reason (optional)" value={reason} onChange={setReason} maxLength={200} multiline rows={3} />
        {cancelError ? (
          <p role="alert" className={styles.notice}>
            {cancelError}
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}
