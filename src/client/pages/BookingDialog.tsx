// Booking confirmation shared by Find a space and the resource calendar. Validates
// inline with the shared rules, then POSTs with an Idempotency-Key bound to the body it
// carries: a retry of an unanswered request reuses it, anything else gets a new one.
// After a conflict the dialog never offers to resend a body it knows conflicts: a lost
// race offers Pick another time (back to that row of the grid), and a clash with the
// person's own booking links to My bookings with Confirm disabled.
import { type RefObject, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { type Reservation, type Resource, ReserveResponse } from "../../shared/api.ts";
import { validate } from "../../shared/rules.ts";
import { ApiClientError, api, idempotencyKey } from "../api/client.ts";
import { Button } from "../ui/Button.tsx";
import { longDate } from "../ui/DateGrid.tsx";
import { Dialog } from "../ui/Dialog.tsx";
import { TextField } from "../ui/TextField.tsx";
import styles from "./pages.module.css";
import { type SiteContext, durationHint, timeRange } from "./site.ts";

export interface BookingDialogProps {
  open: boolean;
  onClose: () => void;
  resource: Resource | null;
  date: string;
  startMin: number;
  endMin: number;
  site: SiteContext;
  onBooked: (reservation: Reservation) => void;
  /** Called after a 409 so the page can refresh what it shows. */
  onConflict: () => void;
  /** After someone else took the time: close and put focus back in the grid. */
  onPickAnother?: () => void;
  /** Focus target when the dialog closes and its opener is disabled (passed to Dialog). */
  returnFocus?: RefObject<HTMLElement | null>;
  /** History state for the week calendar link (Find a space passes its search). */
  calendarState?: unknown;
}

export function BookingDialog({ open, onClose, resource, date, startMin, endMin, site, onBooked, onConflict, onPickAnother, returnFocus, calendarState }: BookingDialogProps) {
  const [attendees, setAttendees] = useState("1");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // A 409 for this dialog session: someone else's booking, or the person's own.
  const [conflict, setConflict] = useState<"resource" | "employee" | null>(null);
  const pickRef = useRef<HTMLButtonElement>(null);
  const problemRef = useRef<HTMLParagraphElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const attendeesRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  // When the selection breaks a rule, the dialog opens on the reason (Confirm is disabled).
  const issuesRef = useRef<HTMLUListElement>(null);
  // The ledger binds a key to the first body it saw and stores every answer under it,
  // 409 and 422 included (SPEC 7.1). So a key is reused only to retry the same body after
  // no definitive answer (network error, 5xx); a changed body or a resubmit after a 409 or
  // 422 is a new booking attempt with a new key.
  const attempt = useRef<{ body: string; key: string } | null>(null);

  useEffect(() => {
    if (open) {
      attempt.current = null;
      setAttendees("1");
      setTitle("");
      setProblem(null);
      setFieldErrors({});
      setConflict(null);
    }
  }, [open]);

  // The button that was pressed is replaced or disabled by a conflict: move focus to
  // the way on.
  useEffect(() => {
    if (conflict === "resource") pickRef.current?.focus();
    if (conflict === "employee") problemRef.current?.focus();
  }, [conflict]);

  // A 422 about a field: focus goes to that field, to correct it. Any other failure shows
  // a role="alert" message, which the Dialog moves focus to.
  useEffect(() => {
    if (fieldErrors.attendees) attendeesRef.current?.focus();
    else if (fieldErrors.title) titleRef.current?.focus();
  }, [fieldErrors]);

  if (!resource) return null;
  const isRoom = resource.kind === "room";
  const input = {
    resourceId: resource.id,
    date,
    startMin,
    endMin,
    attendees: isRoom ? Number(attendees) : 1,
    title: isRoom && title.trim() ? title.trim() : undefined,
  };
  const issues = validate(input, { id: resource.id, kind: resource.kind, capacity: resource.capacity, active: resource.active }, site.rules, Date.now());
  const ruleIssues = issues.filter((i) => i.path !== "attendees" && i.path !== "title");
  const attendeesError = fieldErrors.attendees ?? issues.find((i) => i.path === "attendees")?.message ?? null;
  const titleError = fieldErrors.title ?? issues.find((i) => i.path === "title")?.message ?? null;

  async function confirm() {
    if (!resource || issues.length > 0 || conflict) return;
    setPending(true);
    setProblem(null);
    setFieldErrors({});
    const body = JSON.stringify(input);
    const key = attempt.current?.body === body ? attempt.current.key : idempotencyKey();
    attempt.current = { body, key };
    try {
      const res = await api.post("/api/reservations", input, ReserveResponse, { "Idempotency-Key": key });
      onBooked(res.reservation);
    } catch (err) {
      if (err instanceof ApiClientError && (err.status === 409 || err.status === 422)) attempt.current = null;
      if (err instanceof ApiClientError && err.status === 409) {
        const conflicts = (err.body.conflicts as { startMin: number; endMin: number }[] | undefined) ?? [];
        const when = conflicts.map((c) => timeRange(c.startMin, c.endMin)).join(", ");
        setProblem(
          err.code === "employee_conflict"
            ? `You already have a ${resource.kind} booked at that time${when ? ` (${when})` : ""}.`
            : `Someone else booked this first${when ? `: ${when} is taken` : ""}. The grid has been refreshed; pick another time.`,
        );
        setConflict(err.code === "employee_conflict" ? "employee" : "resource");
        onConflict();
      } else if (err instanceof ApiClientError && err.status === 422) {
        const fields = err.fieldErrors();
        setFieldErrors(fields);
        setProblem(fields.attendees || fields.title ? null : (Object.values(fields)[0] ?? err.message));
      } else {
        setProblem("The booking could not be saved. Try again.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`Book ${resource.name}`}
      dismissable={!pending}
      initialFocus={ruleIssues.length > 0 ? issuesRef : confirmRef}
      returnFocus={returnFocus}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          {conflict === "resource" ? (
            <Button key="pick" ref={pickRef} onClick={onPickAnother ?? onClose}>
              Pick another time
            </Button>
          ) : (
            <Button key="confirm" ref={confirmRef} onClick={() => void confirm()} loading={pending} disabled={issues.length > 0 || conflict === "employee"}>
              Confirm booking
            </Button>
          )}
        </>
      }
    >
      <dl className={styles.dl}>
        <dt>Space</dt>
        <dd>
          {resource.name}, floor {resource.floor} {resource.zone}
        </dd>
        <dt>Date</dt>
        <dd>{longDate(date)}</dd>
        <dt>Time</dt>
        <dd>{timeRange(startMin, endMin)}</dd>
      </dl>
      <p className={styles.muted}>{durationHint(resource.kind)}</p>
      {ruleIssues.length > 0 ? (
        <ul ref={issuesRef} tabIndex={-1} role="alert" className={styles.errorSummary}>
          {ruleIssues.map((i) => (
            <li key={`${i.path}-${i.code}`}>{i.message}</li>
          ))}
        </ul>
      ) : null}
      {isRoom ? (
        <>
          <TextField
            label="Attendees"
            type="number"
            inputMode="numeric"
            value={attendees}
            onChange={setAttendees}
            inputRef={attendeesRef}
            hint={`Up to ${resource.capacity}.`}
            error={attendeesError}
            required
          />
          <TextField label="Meeting title (optional)" value={title} onChange={setTitle} maxLength={80} error={titleError} inputRef={titleRef} />
        </>
      ) : null}
      {problem ? (
        <p ref={problemRef} tabIndex={-1} role="alert" className={styles.notice}>
          {problem}
          {conflict === "employee" ? (
            <>
              {" "}
              <Link to="/bookings">See my bookings</Link>
            </>
          ) : null}
        </p>
      ) : null}
      <Link to={`/resources/${resource.id}?date=${date}`} state={calendarState}>
        See the week calendar for {resource.name}
      </Link>
    </Dialog>
  );
}
