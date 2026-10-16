// My bookings (SPEC 14.1): Upcoming, Past and Cancelled tabs; cancel with an optional
// reason in a Dialog; a cancelled row moves to the Cancelled tab. Space names come with
// the list itself, so a space deactivated after it was booked still shows its name,
// marked "(not bookable now)" and without a calendar link.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { type Reservation, ReservationsResponse, ReserveResponse } from "../../shared/api.ts";
import { hasStarted } from "../../shared/rules.ts";
import { addDays } from "../../shared/time.ts";
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
  const banner = useStatusBanner();
  const [tab, setTab] = useState("upcoming");
  const [list, setList] = useState<Reservation[] | null>(null);
  const [spaces, setSpaces] = useState<Map<string, { name: string; active: boolean }>>(new Map());
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
      const res = await api.get(`/api/reservations${qs({ from, to })}`, ReservationsResponse);
      setList(res.reservations);
      setSpaces(new Map((res.resources ?? []).map((r) => [r.id, { name: r.name, active: r.active }])));
      setError(null);
    } catch {
      setError("Your bookings could not be loaded.");
    }
  }, [site.today, site.rules.horizonDays]);

  /** The space's name, marked when it can no longer be booked. */
  const spaceName = (id: string) => {
    const s = spaces.get(id);
    if (!s) return id;
    return s.active ? s.name : `${s.name} (not bookable now)`;
  };
  const bookable = (id: string) => spaces.get(id)?.active !== false;

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
      const text = `Cancelled ${spaces.get(cancelling.resourceId)?.name ?? "the booking"} on ${longDate(cancelling.date)}.`;
      announce(text);
      // The cancelled row leaves the Upcoming list, so the result takes focus.
      banner.show({ text, link: { to: "/find", label: "Find a space" }, focus: true });
      setCancelling(null);
      await load();
    } catch (err) {
      setCancelError(err instanceof ApiClientError ? err.message : "The booking could not be cancelled.");
    } finally {
      setPending(false);
    }
  }

  const columns = [
    {
      key: "space",
      header: "Space",
      render: (r: Reservation) => (bookable(r.resourceId) ? <Link to={`/resources/${r.resourceId}`}>{spaceName(r.resourceId)}</Link> : spaceName(r.resourceId)),
      sortValue: (r: Reservation) => spaceName(r.resourceId),
    },
    { key: "date", header: "Date", render: (r: Reservation) => longDate(r.date), sortValue: (r: Reservation) => `${r.date} ${String(r.startMin).padStart(4, "0")}` },
    { key: "time", header: "Time", render: (r: Reservation) => timeRange(r.startMin, r.endMin) },
    { key: "details", header: "Details", render: (r: Reservation) => (r.kind === "room" ? `${r.attendees} attending${r.title ? `, ${r.title}` : ""}` : "Desk") },
  ];
  const cancelledColumns = [...columns, { key: "reason", header: "Reason", render: (r: Reservation) => r.cancelReason ?? "None given" }];

  return (
    <section className={styles.stack}>
      <h1>My bookings</h1>
      {error ? (
        <LoadError
          message={error}
          onRetry={() => {
            setError(null);
            return load();
          }}
        />
      ) : list === null ? (
        <p role="status">Loading your bookings…</p>
      ) : (
      <Tabs tabs={TABS} value={tab} onChange={setTab} label="Bookings">
        {(id) => (
          <DataTable
            caption={`${TABS.find((t) => t.id === id)?.label ?? ""} bookings`}
            columns={id === "cancelled" ? cancelledColumns : columns}
            rows={groups[id] ?? []}
            rowKey={(r) => r.id}
            empty={
              id === "upcoming" ? (
                <>
                  No upcoming bookings. <Link to="/find">Find a space</Link> to book one.
                </>
              ) : (
                "Nothing here."
              )
            }
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
                        for {spaceName(r.resourceId)} on {longDate(r.date)}
                      </span>
                    </Button>
                  )
                : undefined
            }
          />
        )}
      </Tabs>
      )}
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
            {spaceName(cancelling.resourceId)}, {longDate(cancelling.date)}, {timeRange(cancelling.startMin, cancelling.endMin)}.
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
