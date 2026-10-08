// Find a space (SPEC 14.1): filters, a date, live availability for every matching
// resource, select a range in the SlotGrid, confirm in a Dialog.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { type AvailabilityResponse, AvailabilityResponse as AvailabilitySchema, type Reservation, type Resource } from "../../shared/api.ts";
import { AMENITIES } from "../../shared/synthetic/resources.ts";
import { formatMinutes } from "../../shared/time.ts";
import { api, qs } from "../api/client.ts";
import { useLiveAvailability } from "../live/useLiveAvailability.ts";
import { useAnnounce } from "../shell/Announcer.tsx";
import { Button } from "../ui/Button.tsx";
import { DateGrid, longDate } from "../ui/DateGrid.tsx";
import { SlotGrid, type SlotRow, type SlotSelection } from "../ui/SlotGrid.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import { TextField } from "../ui/TextField.tsx";
import { BookingDialog } from "./BookingDialog.tsx";
import styles from "./pages.module.css";
import { dateDisabledReason, firstBookableDate, minStartOn, timeRange, useSite } from "./site.ts";
import { usePageTitle } from "./usePageTitle.ts";

const KIND_TABS = [
  { id: "all", label: "All spaces" },
  { id: "desk", label: "Desks" },
  { id: "room", label: "Rooms" },
];

export function FindSpacePage() {
  usePageTitle("Find a space");
  const site = useSite();
  const announce = useAnnounce();
  const [kind, setKind] = useState("all");
  const [floor, setFloor] = useState("");
  const [amenities, setAmenities] = useState<string[]>([]);
  const [minCapacity, setMinCapacity] = useState("");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [date, setDate] = useState(() => firstBookableDate(site));
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  // The booking being confirmed, captured when the dialog opens so live updates to the
  // grid selection cannot change or close it mid-request.
  const [booking, setBooking] = useState<{ resource: Resource; startMin: number; endMin: number } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const query = qs({
    date,
    kind: kind === "all" ? undefined : kind,
    floor: floor || undefined,
    amenity: amenities.length ? amenities.join(",") : undefined,
    minCapacity: minCapacity || undefined,
    q: q.trim() || undefined,
    from: from && to ? from : undefined,
    to: from && to ? to : undefined,
  });

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/sites/${site.siteId}/availability${query}`, AvailabilitySchema)
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setLoadError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Availability could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [site.siteId, query, refreshTick]);

  const live = useLiveAvailability(site.siteId, [date]);
  const liveDate = live.byDate[date];

  const rows: SlotRow[] = useMemo(() => {
    if (!data) return [];
    const useLive = liveDate !== undefined && liveDate.dateVersion >= data.version;
    const windowSet = from && to && Number(to) > Number(from);
    return data.resources
      .filter((r) => !windowSet || r.fitsWindow)
      .map((r) => ({
        id: r.resource.id,
        label: r.resource.kind === "room" ? `${r.resource.name} (${r.resource.capacity})` : r.resource.name,
        busy: useLive ? (liveDate.busy[r.resource.id] ?? []) : r.busy,
      }));
  }, [data, liveDate, from, to]);

  const selectedResource = data?.resources.find((r) => r.resource.id === selection?.rowId)?.resource ?? null;
  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);
  const onSelect = useCallback((s: SlotSelection | null) => setSelection(s), []);

  const onBooked = (r: Reservation) => {
    const name = booking?.resource.name ?? r.resourceId;
    setBooking(null);
    setSelection(null);
    announce(`Booked ${name} on ${longDate(r.date)}, ${timeRange(r.startMin, r.endMin)}.`);
    refresh();
  };

  const times: number[] = [];
  for (let m = site.rules.openMin; m <= site.rules.closeMin; m += 30) times.push(m);

  return (
    <section className={styles.stack}>
      <div className={styles.row}>
        <h1>Find a space</h1>
        <span className={styles.status} role="status">
          <span className={`${styles.dot} ${live.status === "live" ? styles.dotLive : ""}`} aria-hidden="true" />
          {live.status === "live" ? "Live updates on" : live.status === "connecting" ? "Connecting to live updates" : "Live updates offline, retrying"}
        </span>
      </div>
      <div className={styles.layout}>
        <div className={styles.stack}>
          <div className={styles.panel}>
            <DateGrid label="Booking date" value={date} today={site.today} onChange={(d) => {
              setDate(d);
              setSelection(null);
            }} isDisabled={(d) => dateDisabledReason(d, site)} />
          </div>
          <form className={styles.panel} role="search" aria-label="Filter spaces" onSubmit={(e) => e.preventDefault()}>
            <fieldset className={styles.filters}>
              <legend className="visually-hidden">Filters</legend>
              <TextField label="Search" type="search" value={q} onChange={setQ} placeholder="Name, zone or amenity" />
              <label className={styles.selectLabel}>
                Floor
                <select className={styles.select} value={floor} onChange={(e) => setFloor(e.target.value)}>
                  <option value="">Any floor</option>
                  <option value="2">Floor 2</option>
                  <option value="3">Floor 3</option>
                </select>
              </label>
              <label className={styles.selectLabel}>
                Seats
                <select className={styles.select} value={minCapacity} onChange={(e) => setMinCapacity(e.target.value)}>
                  <option value="">Any size</option>
                  {[2, 4, 6, 8, 10].map((n) => (
                    <option key={n} value={n}>
                      {n} or more
                    </option>
                  ))}
                </select>
              </label>
              <fieldset className={styles.checkboxes}>
                <legend>Amenities</legend>
                {AMENITIES.map((a) => (
                  <label key={a.id} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={amenities.includes(a.id)}
                      onChange={(e) => setAmenities((list) => (e.target.checked ? [...list, a.id] : list.filter((x) => x !== a.id)))}
                    />
                    {a.label}
                  </label>
                ))}
              </fieldset>
              <div className={styles.row}>
                <label className={styles.selectLabel}>
                  Free from
                  <select className={styles.select} value={from} onChange={(e) => setFrom(e.target.value)}>
                    <option value="">Any time</option>
                    {times.slice(0, -1).map((m) => (
                      <option key={m} value={m}>
                        {formatMinutes(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.selectLabel}>
                  Until
                  <select className={styles.select} value={to} onChange={(e) => setTo(e.target.value)}>
                    <option value="">Any time</option>
                    {times.slice(1).map((m) => (
                      <option key={m} value={m}>
                        {formatMinutes(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>
          </form>
        </div>
        <div className={styles.stack}>
          <Tabs tabs={KIND_TABS} value={kind} onChange={(k) => {
            setKind(k);
            setSelection(null);
          }} label="Kind of space">
            {() => (
              <div className={styles.stack}>
                {loadError ? <p role="alert">{loadError}</p> : null}
                {data === null && !loadError ? <p role="status">Loading availability…</p> : null}
                {data !== null ? (
                  <>
                    <p className={styles.muted}>
                      {rows.length} {rows.length === 1 ? "space" : "spaces"} on {longDate(date)}.
                    </p>
                    {rows.length > 0 ? (
                      <SlotGrid
                        label={`Availability on ${longDate(date)}`}
                        rows={rows}
                        openMin={site.rules.openMin}
                        closeMin={site.rules.closeMin}
                        selection={selection}
                        onSelect={onSelect}
                        minStartFor={() => minStartOn(date, site)}
                      />
                    ) : (
                      <p>No spaces match these filters.</p>
                    )}
                  </>
                ) : null}
                <div className={styles.row}>
                  <Button
                    disabled={!selection || !selectedResource}
                    onClick={() => selection && selectedResource && setBooking({ resource: selectedResource, startMin: selection.startMin, endMin: selection.endMin })}
                  >
                    {selection && selectedResource ? `Book ${selectedResource.name}, ${timeRange(selection.startMin, selection.endMin)}` : "Select a time to book"}
                  </Button>
                </div>
                {data && data.resources.length > 0 ? (
                  <details>
                    <summary>Week calendars</summary>
                    <ul className={styles.inlineList}>
                      {data.resources.map((r) => (
                        <li key={r.resource.id}>
                          <Link to={`/resources/${r.resource.id}`}>{r.resource.name}</Link>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </div>
            )}
          </Tabs>
        </div>
      </div>
      <BookingDialog
        open={booking !== null}
        onClose={() => setBooking(null)}
        resource={booking?.resource ?? null}
        date={date}
        startMin={booking?.startMin ?? 0}
        endMin={booking?.endMin ?? 0}
        site={site}
        onBooked={onBooked}
        onConflict={refresh}
      />
    </section>
  );
}
