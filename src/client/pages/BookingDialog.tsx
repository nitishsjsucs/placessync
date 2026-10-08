// Booking confirmation shared by Find a space and the resource calendar. Validates
// inline with the shared rules, then POSTs with a fresh Idempotency-Key per opening.
import { useEffect, useMemo, useRef, useState } from "react";
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
}

export function BookingDialog({ open, onClose, resource, date, startMin, endMin, site, onBooked, onConflict }: BookingDialogProps) {
  const [attendees, setAttendees] = useState("1");
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const confirmRef = useRef<HTMLButtonElement>(null);
  // One key per opening: a retried click is the same booking attempt.
  const key = useMemo(() => (open ? idempotencyKey() : ""), [open]);

  useEffect(() => {
    if (open) {
      setAttendees("1");
      setTitle("");
      setProblem(null);
      setFieldErrors({});
    }
  }, [open]);

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
    if (!resource || issues.length > 0) return;
    setPending(true);
    setProblem(null);
    setFieldErrors({});
    try {
      const res = await api.post("/api/reservations", input, ReserveResponse, { "Idempotency-Key": key });
      onBooked(res.reservation);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 409) {
        const conflicts = (err.body.conflicts as { startMin: number; endMin: number }[] | undefined) ?? [];
        const when = conflicts.map((c) => timeRange(c.startMin, c.endMin)).join(", ");
        setProblem(
          err.code === "employee_conflict"
            ? `You already have a ${resource.kind} booked at that time${when ? ` (${when})` : ""}.`
            : `Someone else booked this first${when ? `: ${when} is taken` : ""}. The grid has been refreshed; pick another time.`,
        );
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
      initialFocus={confirmRef}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button ref={confirmRef} onClick={() => void confirm()} loading={pending} disabled={issues.length > 0}>
            Confirm booking
          </Button>
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
        <ul role="alert" className={styles.errorSummary}>
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
            hint={`Up to ${resource.capacity}.`}
            error={attendeesError}
            required
          />
          <TextField label="Meeting title (optional)" value={title} onChange={setTitle} maxLength={80} error={titleError} />
        </>
      ) : null}
      {problem ? (
        <p role="alert" className={styles.notice}>
          {problem}
        </p>
      ) : null}
      <Link to={`/resources/${resource.id}`}>See the week calendar for {resource.name}</Link>
    </Dialog>
  );
}
