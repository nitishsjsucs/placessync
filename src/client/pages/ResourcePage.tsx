// Resource detail and week booking calendar (SPEC 14.1): a SlotGrid with the seven days
// as rows, live updates for the week's dates, and booking from a selected range. The
// first week comes from ?date (Find a space links carry its date) and the shown week is
// kept in ?week, written with replace. Without either, the week is the one with the first
// bookable date when the page opened (fixed, so it never flips at 18:30 on a Friday), and
// changing the week clears the selection, which belongs to a day of the old week.
// A link from Find a space carries its search in the history state, so "Back to Find a
// space" returns to the same tab and filters, on a date in the week in view.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams, useSearchParams } from "react-router";
import { type CalendarResponse, CalendarResponse as CalendarSchema, type Reservation } from "../../shared/api.ts";
import { AMENITIES } from "../../shared/synthetic/resources.ts";
import { DATE_RE, addDays, isValidDate, isWeekday, weekStartOf } from "../../shared/time.ts";
import { ApiClientError, api, qs } from "../api/client.ts";
import { useLiveAvailability } from "../live/useLiveAvailability.ts";
import { useAnnounce } from "../shell/Announcer.tsx";
import { LoadError } from "../shell/LoadError.tsx";
import { useStatusBanner } from "../shell/StatusBanner.tsx";
import { Button } from "../ui/Button.tsx";
import { DateGrid, longDate } from "../ui/DateGrid.tsx";
import { SlotGrid, type SlotGridHandle, type SlotRow, type SlotSelection } from "../ui/SlotGrid.tsx";
import { BookingDialog } from "./BookingDialog.tsx";
import styles from "./pages.module.css";
import { bookableDateParam, findLink, fromFindState } from "./find-params.ts";
import { dateDisabledReason, dateUnavailableWord, firstBookableDate, minSlots, minStartOn, shortSelectionHint, timeRange, useSite } from "./site.ts";
import { usePageTitle } from "./usePageTitle.ts";

const AMENITY_LABELS = new Map(AMENITIES.map((a) => [a.id, a.label]));
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function ResourcePage() {
  const { id = "" } = useParams();
  const site = useSite();
  const announce = useAnnounce();
  const banner = useStatusBanner();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const findSearch = fromFindState(location.state);
  const dateParam = bookableDateParam(params.get("date"), site);
  const weekParam = params.get("week");
  const [fallbackDate] = useState(() => firstBookableDate(site));
  const weekStart = weekParam && DATE_RE.test(weekParam) && isValidDate(weekParam) ? weekStartOf(weekParam) : weekStartOf(dateParam ?? fallbackDate);
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<"not_found" | "failed" | null>(null);
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const setWeekStart = (week: string) => {
    setSelection(null);
    setParams(new URLSearchParams({ week }), { replace: true, state: location.state });
  };
  const [booking, setBooking] = useState<SlotSelection | null>(null);
  const [tick, setTick] = useState(0);
  const [liveClear, setLiveClear] = useState<string | null>(null);
  const gridRef = useRef<SlotGridHandle>(null);
  const slotsRef = useRef<HTMLDivElement>(null);
  const [focusTarget, setFocusTarget] = useState<SlotSelection | null>(null);
  usePageTitle(data ? data.resource.name : "Resource");

  // Another space: nothing from the previous one (its data or its error) carries over.
  useEffect(() => {
    setData(null);
    setError(null);
    setSelection(null);
  }, [id]);

  useEffect(() => {
    setSelection(null);
  }, [weekStart]);

  useEffect(() => {
    let cancelled = false;
    api
      .get(`/api/resources/${encodeURIComponent(id)}/calendar${qs({ weekStart })}`, CalendarSchema)
      .then((r) => {
        if (!cancelled) {
          setData(r);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiClientError && err.status === 404 ? "not_found" : "failed");
      });
    return () => {
      cancelled = true;
    };
  }, [id, weekStart, tick]);

  const weekDates = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);
  const live = useLiveAvailability(site.siteId, weekDates.filter(isWeekday));

  const rows: SlotRow[] = useMemo(() => {
    if (!data) return [];
    return data.days.map((day, i) => {
      const liveDay = live.byDate[day.date];
      return {
        id: day.date,
        label: `${DAY_NAMES[i] ?? ""} ${day.date.slice(5).replace("-", "/")}`,
        busy: liveDay ? (liveDay.busy[data.resource.id] ?? []) : day.busy,
      };
    });
  }, [data, live.byDate]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);
  const onSelect = useCallback((s: SlotSelection | null) => {
    setSelection(s);
    if (s) setLiveClear(null);
  }, []);

  useEffect(() => {
    if (!focusTarget) return;
    gridRef.current?.focusRow(focusTarget.rowId, focusTarget.startMin);
    setFocusTarget(null);
  }, [focusTarget]);

  const onBooked = (r: Reservation) => {
    setBooking(null);
    setSelection(null);
    const text = `Booked ${data?.resource.name ?? ""} on ${longDate(r.date)}, ${timeRange(r.startMin, r.endMin)}.`;
    announce(text);
    banner.show({ text, link: { to: "/bookings", label: "See My bookings" }, focus: true });
    refresh();
  };

  if (error === "not_found") {
    return (
      <section className={styles.stack}>
        <h1>Space</h1>
        <p role="alert">There is no such space.</p>
        <p>
          <Link to="/find">Find a space</Link>
        </p>
      </section>
    );
  }
  if (error) {
    return (
      <section className={styles.stack}>
        <h1>Space</h1>
        <LoadError
          message="The calendar could not be loaded."
          onRetry={() => {
            setError(null);
            refresh();
          }}
        />
      </section>
    );
  }
  if (!data) return <p role="status">Loading the calendar…</p>;
  const r = data.resource;
  // Back to Find a space on a date in view: the selected one, the one this page was opened
  // for, or the first bookable day of the shown week.
  const inWeek = (d: string | null | undefined) => !!d && d >= weekStart && d <= addDays(weekStart, 6) && !dateDisabledReason(d, site);
  const backDate = [selection?.rowId, dateParam, ...Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))].find(inWeek);

  return (
    <section className={styles.stack}>
      <p>
        <Link to={findLink(findSearch, backDate, site)}>Back to Find a space</Link>
      </p>
      <h1>{r.name}</h1>
      <dl className={styles.dl}>
        <dt>Kind</dt>
        <dd>{r.kind === "desk" ? "Desk" : `Meeting room for up to ${r.capacity}`}</dd>
        <dt>Location</dt>
        <dd>
          Floor {r.floor}, {r.zone} side
        </dd>
        <dt>Amenities</dt>
        <dd>{r.amenities.map((a) => AMENITY_LABELS.get(a) ?? a).join(", ") || "None"}</dd>
        <dt>About</dt>
        <dd>{r.description}</dd>
      </dl>
      <div className={styles.layout}>
        <div className={styles.panel}>
          <DateGrid
            label="Jump to week"
            value={weekStart}
            today={site.today}
            onChange={(d) => setWeekStart(weekStartOf(d))}
            isDisabled={() => null}
          />
        </div>
        <div className={styles.stack}>
          <div className={styles.row}>
            <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>
              Previous week
            </Button>
            <h2 aria-live="polite">Week of {longDate(weekStart)}</h2>
            <Button variant="secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>
              Next week
            </Button>
          </div>
          <div id="slots" ref={slotsRef} tabIndex={-1}>
          <SlotGrid
            ref={gridRef}
            onLiveClear={setLiveClear}
            label={`${r.name}, week of ${longDate(weekStart)}`}
            rows={rows}
            rowHeader="Day"
            openMin={site.rules.openMin}
            closeMin={site.rules.closeMin}
            selection={selection}
            onSelect={onSelect}
            minStartFor={(date) => minStartOn(date, site)}
            rowUnavailable={(date) => dateUnavailableWord(date, site)}
            minSlotsFor={() => minSlots(r.kind)}
          />
          </div>
          <div className={styles.row}>
            <Button disabled={!selection} onClick={() => selection && setBooking(selection)}>
              {selection ? `Book ${longDate(selection.rowId)}, ${timeRange(selection.startMin, selection.endMin)}` : "Select a time to book"}
            </Button>
            {selection && shortSelectionHint(r.kind, selection.startMin, selection.endMin) ? (
              <p className={styles.muted}>{shortSelectionHint(r.kind, selection.startMin, selection.endMin)}</p>
            ) : null}
            {liveClear ? <p className={styles.notice}>{liveClear}</p> : null}
          </div>
        </div>
      </div>
      <BookingDialog
        open={booking !== null}
        onClose={() => setBooking(null)}
        resource={r}
        date={booking?.rowId ?? weekStart}
        startMin={booking?.startMin ?? 0}
        endMin={booking?.endMin ?? 0}
        site={site}
        onBooked={onBooked}
        onConflict={refresh}
        returnFocus={slotsRef}
        calendarState={location.state}
        onPickAnother={() => {
          setFocusTarget(booking);
          setBooking(null);
        }}
      />
    </section>
  );
}
