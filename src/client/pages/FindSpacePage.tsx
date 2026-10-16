// Find a space (SPEC 14.1): filters, a date, live availability for every matching
// resource, select a range in the SlotGrid, confirm in a Dialog. The date, tab and
// filters live in the URL (find-params.ts), written with replace so Back leaves the page.
// Below 1024 px the filters fold into a disclosure, so availability comes first on phones
// and tablets; under 640 px the Book button stays above the bottom nav while chips scroll.
// The default date (the first that can still be booked) is fixed when the page opens: if
// it followed the clock, an open page would move to the next working day at 18:30 and
// keep the selection made on the day before. Anything that changes the date clears the
// selection, and the booking dialog books the date it was opened for.
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { type AvailabilityResponse, AvailabilityResponse as AvailabilitySchema, type Reservation, type Resource } from "../../shared/api.ts";
import { AMENITIES } from "../../shared/synthetic/resources.ts";
import { formatMinutes } from "../../shared/time.ts";
import { ApiClientError, api, qs } from "../api/client.ts";
import { COMPACT_QUERY, NARROW_QUERY, useMediaQuery } from "../hooks/useMediaQuery.ts";
import { useLiveAvailability } from "../live/useLiveAvailability.ts";
import { useAnnounce } from "../shell/Announcer.tsx";
import { LoadError } from "../shell/LoadError.tsx";
import { useStatusBanner } from "../shell/StatusBanner.tsx";
import { Button } from "../ui/Button.tsx";
import { DateGrid, longDate } from "../ui/DateGrid.tsx";
import { SlotGrid, type SlotGridHandle, type SlotRow, type SlotSelection } from "../ui/SlotGrid.tsx";
import { Tabs } from "../ui/Tabs.tsx";
import { TextField } from "../ui/TextField.tsx";
import { BookingDialog } from "./BookingDialog.tsx";
import { CAPACITIES, FLOORS, type FindFilters, type Kind, NO_FILTERS, Q_MAX, activeFilterCount, fromTimes, parseFindParams, toTimes, writeFindParams } from "./find-params.ts";
import styles from "./pages.module.css";
import { dateDisabledReason, firstBookableDate, minSlots, minStartOn, shortSelectionHint, timeRange, todayHasClosed, useSite } from "./site.ts";
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
  const banner = useStatusBanner();
  const [params, setParams] = useSearchParams();
  const [defaultDate] = useState(() => firstBookableDate(site));
  const filters = parseFindParams(params, site, defaultDate);
  const { date, kind, floor, amenities, minCapacity, q, from, to } = filters;
  const update = (patch: Partial<FindFilters>) => {
    setParams((prev) => writeFindParams({ ...parseFindParams(prev, site, defaultDate), ...patch }, defaultDate), { replace: true });
  };
  const narrow = useMediaQuery(NARROW_QUERY);
  const compact = useMediaQuery(COMPACT_QUERY);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = activeFilterCount(filters);
  const filtersToggleRef = useRef<HTMLButtonElement>(null);
  // Clear filters removes itself (it shows only while filters are set or nothing
  // matches), so focus moves on: to the Filters toggle from inside the disclosure, to the
  // slot area from the no-match message.
  const clearFilters = (focusTo: RefObject<HTMLElement | null>) => {
    update({ ...NO_FILTERS });
    focusTo.current?.focus();
  };
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // A search the API refused (422): shown on the Search field, with the last grid kept.
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  // The booking being confirmed, captured when the dialog opens so live updates to the
  // grid selection cannot change or close it mid-request.
  const [booking, setBooking] = useState<{ resource: Resource; date: string; startMin: number; endMin: number } | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  // "1 to 2 on Desk 2A-01 was just booked by someone else", shown until the next selection.
  const [liveClear, setLiveClear] = useState<string | null>(null);
  const gridRef = useRef<SlotGridHandle>(null);
  // The "Skip to availability" target, and where focus goes if a dialog closes after
  // the Book button was disabled.
  const slotsRef = useRef<HTMLDivElement>(null);
  const [focusTarget, setFocusTarget] = useState<{ rowId: string; startMin: number } | null>(null);

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
          setSearchError(null);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // Trying the same search again cannot help, so say what to change instead.
        const refused = err instanceof ApiClientError && err.status === 422 ? err.fieldErrors().q : undefined;
        if (refused) {
          setSearchError(refused);
          setFiltersOpen(true);
        } else setLoadError("Availability could not be loaded.");
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
  const kindById = useMemo(() => new Map((data?.resources ?? []).map((r) => [r.resource.id, r.resource.kind])), [data]);
  const minSlotsFor = useCallback((id: string) => minSlots(kindById.get(id) ?? "room"), [kindById]);
  const tooShort = selection && selectedResource ? shortSelectionHint(selectedResource.kind, selection.startMin, selection.endMin) : null;
  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);
  const retry = () => {
    setLoadError(null);
    setData(null);
    refresh();
  };
  const onSelect = useCallback((s: SlotSelection | null) => {
    setSelection(s);
    if (s) setLiveClear(null);
  }, []);

  // A selection belongs to the date it was made on.
  useEffect(() => {
    setSelection(null);
  }, [date]);

  // After Pick another time: runs after the closing Dialog's focus restore in the same commit.
  useEffect(() => {
    if (!focusTarget) return;
    gridRef.current?.focusRow(focusTarget.rowId, focusTarget.startMin);
    setFocusTarget(null);
  }, [focusTarget]);

  const onBooked = (r: Reservation) => {
    const name = booking?.resource.name ?? r.resourceId;
    setBooking(null);
    setSelection(null);
    const text = `Booked ${name} on ${longDate(r.date)}, ${timeRange(r.startMin, r.endMin)}.`;
    announce(text);
    // The Book button is disabled once the selection clears, so the result takes focus.
    banner.show({ text, link: { to: "/bookings", label: "See My bookings" }, focus: true });
    refresh();
  };


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
              update({ date: d });
              setSelection(null);
            }} isDisabled={(d) => dateDisabledReason(d, site)} />
          </div>
          <form className={narrow ? styles.stack : styles.panel} role="search" aria-label="Filter spaces" onSubmit={(e) => e.preventDefault()}>
            {narrow ? (
              <div>
                <Button ref={filtersToggleRef} variant="secondary" aria-expanded={filtersOpen} aria-controls="find-filters" onClick={() => setFiltersOpen((o) => !o)}>
                  {activeFilters > 0 ? `Filters (${activeFilters} active)` : "Filters"}
                </Button>
              </div>
            ) : null}
            <fieldset id="find-filters" className={`${styles.filters} ${narrow ? styles.panel : ""}`} hidden={narrow && !filtersOpen}>
              <legend className="visually-hidden">Filters</legend>
              <TextField label="Search" type="search" value={q} onChange={(v) => update({ q: v })} placeholder="Name, zone or amenity" maxLength={Q_MAX} counter={false} error={searchError} />
              <label className={styles.selectLabel}>
                Floor
                <select className={styles.select} value={floor} onChange={(e) => update({ floor: e.target.value })}>
                  <option value="">Any floor</option>
                  {FLOORS.map((f) => (
                    <option key={f} value={f}>
                      Floor {f}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.selectLabel}>
                Seats
                <select className={styles.select} value={minCapacity} onChange={(e) => update({ minCapacity: e.target.value })}>
                  <option value="">Any size</option>
                  {CAPACITIES.map((n) => (
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
                      onChange={(e) => update({ amenities: e.target.checked ? [...amenities, a.id] : amenities.filter((x) => x !== a.id) })}
                    />
                    {a.label}
                  </label>
                ))}
              </fieldset>
              <div className={styles.row}>
                <label className={styles.selectLabel}>
                  Free from
                  <select
                    className={styles.select}
                    value={from}
                    // A start at or after the chosen end replaces that end.
                    onChange={(e) => update({ from: e.target.value, ...(e.target.value && to && Number(to) <= Number(e.target.value) ? { to: "" } : {}) })}
                  >
                    <option value="">Any time</option>
                    {fromTimes(site).map((m) => (
                      <option key={m} value={m}>
                        {formatMinutes(m)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.selectLabel}>
                  Until
                  <select
                    className={styles.select}
                    value={to}
                    onChange={(e) => update({ to: e.target.value, ...(e.target.value && from && Number(e.target.value) <= Number(from) ? { from: "" } : {}) })}
                  >
                    <option value="">Any time</option>
                    {toTimes(site).map((m) => (
                      <option key={m} value={m}>
                        {formatMinutes(m)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {narrow && activeFilters > 0 ? (
                <div>
                  <Button variant="secondary" onClick={() => clearFilters(filtersToggleRef)}>
                    Clear filters
                  </Button>
                </div>
              ) : null}
            </fieldset>
          </form>
        </div>
        <div className={styles.stack}>
          <Tabs tabs={KIND_TABS} value={kind} onChange={(k) => {
            update({ kind: k as Kind });
            setSelection(null);
          }} label="Kind of space">
            {() => (
              <div className={styles.stack}>
                <div id="slots" ref={slotsRef} tabIndex={-1} className={`${styles.stack} ${styles.slotArea}`}>
                {loadError ? <LoadError message={loadError} onRetry={retry} focusAfter={slotsRef} /> : null}
                {data === null && !loadError ? <p role="status">Loading availability…</p> : null}
                {data !== null && !loadError ? (
                  <>
                    {date === defaultDate && date !== site.today && todayHasClosed(site) ? (
                      <p className={styles.muted}>Bookings for today have closed; showing {longDate(date)}.</p>
                    ) : null}
                    <p className={styles.muted}>
                      {rows.length} {rows.length === 1 ? "space" : "spaces"} on {longDate(date)}.
                    </p>
                    {rows.length > 0 ? (
                      <SlotGrid
                        ref={gridRef}
                        onLiveClear={setLiveClear}
                        label={`Availability on ${longDate(date)}`}
                        rows={rows}
                        openMin={site.rules.openMin}
                        closeMin={site.rules.closeMin}
                        selection={selection}
                        onSelect={onSelect}
                        minStartFor={() => minStartOn(date, site)}
                        minSlotsFor={minSlotsFor}
                      />
                    ) : (
                      <div className={styles.row}>
                        <p>No spaces match these filters.</p>
                        <Button variant="secondary" onClick={() => clearFilters(slotsRef)}>
                          Clear filters
                        </Button>
                      </div>
                    )}
                  </>
                ) : null}
                </div>
                <div className={`${styles.row} ${compact && selection ? styles.stickyBook : ""}`}>
                  <Button
                    disabled={!selection || !selectedResource}
                    onClick={() => selection && selectedResource && setBooking({ resource: selectedResource, date, startMin: selection.startMin, endMin: selection.endMin })}
                  >
                    {selection && selectedResource ? `Book ${selectedResource.name}, ${timeRange(selection.startMin, selection.endMin)}` : "Select a time to book"}
                  </Button>
                  {tooShort ? <p className={styles.muted}>{tooShort}</p> : null}
                  {liveClear ? <p className={styles.notice}>{liveClear}</p> : null}
                </div>
                {data && data.resources.length > 0 ? (
                  <details>
                    <summary>Week calendars</summary>
                    <ul className={styles.inlineList}>
                      {data.resources.map((r) => (
                        <li key={r.resource.id}>
                          <Link to={`/resources/${r.resource.id}?date=${date}`}>{r.resource.name}</Link>
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
        date={booking?.date ?? date}
        startMin={booking?.startMin ?? 0}
        endMin={booking?.endMin ?? 0}
        site={site}
        onBooked={onBooked}
        onConflict={refresh}
        returnFocus={slotsRef}
        onPickAnother={() => {
          if (booking) setFocusTarget({ rowId: booking.resource.id, startMin: booking.startMin });
          setBooking(null);
        }}
      />
    </section>
  );
}
