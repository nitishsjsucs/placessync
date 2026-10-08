// Resource detail and week booking calendar (SPEC 14.1): a SlotGrid with the seven days
// as rows, live updates for the week's dates, and booking from a selected range.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { type CalendarResponse, CalendarResponse as CalendarSchema, type Reservation } from "../../shared/api.ts";
import { AMENITIES } from "../../shared/synthetic/resources.ts";
import { addDays, isWeekday, weekStartOf } from "../../shared/time.ts";
import { ApiClientError, api, qs } from "../api/client.ts";
import { useLiveAvailability } from "../live/useLiveAvailability.ts";
import { useAnnounce } from "../shell/Announcer.tsx";
import { Button } from "../ui/Button.tsx";
import { DateGrid, longDate } from "../ui/DateGrid.tsx";
import { SlotGrid, type SlotRow, type SlotSelection } from "../ui/SlotGrid.tsx";
import { BookingDialog } from "./BookingDialog.tsx";
import styles from "./pages.module.css";
import { dateDisabledReason, minStartOn, timeRange, useSite } from "./site.ts";
import { usePageTitle } from "./usePageTitle.ts";

const AMENITY_LABELS = new Map(AMENITIES.map((a) => [a.id, a.label]));
const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function ResourcePage() {
  const { id = "" } = useParams();
  const site = useSite();
  const announce = useAnnounce();
  const [weekStart, setWeekStart] = useState(() => weekStartOf(site.today));
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SlotSelection | null>(null);
  const [booking, setBooking] = useState<SlotSelection | null>(null);
  const [tick, setTick] = useState(0);
  usePageTitle(data ? data.resource.name : "Resource");

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
        if (!cancelled) setError(err instanceof ApiClientError && err.status === 404 ? "There is no such space." : "The calendar could not be loaded.");
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
  const onSelect = useCallback((s: SlotSelection | null) => setSelection(s), []);

  const onBooked = (r: Reservation) => {
    setBooking(null);
    setSelection(null);
    announce(`Booked ${data?.resource.name ?? ""} on ${longDate(r.date)}, ${timeRange(r.startMin, r.endMin)}.`);
    refresh();
  };

  if (error) {
    return (
      <section>
        <h1>Space</h1>
        <p role="alert">{error}</p>
      </section>
    );
  }
  if (!data) return <p role="status">Loading…</p>;
  const r = data.resource;

  return (
    <section className={styles.stack}>
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
            onChange={(d) => {
              setWeekStart(weekStartOf(d));
              setSelection(null);
            }}
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
          <SlotGrid
            label={`${r.name}, week of ${longDate(weekStart)}`}
            rows={rows}
            rowHeader="Day"
            openMin={site.rules.openMin}
            closeMin={site.rules.closeMin}
            selection={selection}
            onSelect={onSelect}
            minStartFor={(date) => (dateDisabledReason(date, site) ? site.rules.closeMin : minStartOn(date, site))}
          />
          <div className={styles.row}>
            <Button disabled={!selection} onClick={() => selection && setBooking(selection)}>
              {selection ? `Book ${longDate(selection.rowId)}, ${timeRange(selection.startMin, selection.endMin)}` : "Select a time to book"}
            </Button>
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
      />
    </section>
  );
}
