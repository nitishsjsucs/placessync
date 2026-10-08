// Pure booking rules (SPEC 7.1). The ledger runs them inside its transaction and the
// client runs them for inline validation. Hours and horizon always come from a
// SiteRules value, never from constants.
import { DATE_RE, SLOT_MINUTES, daysBetween, isValidDate, isWeekday, siteClock } from "./time.ts";

export interface SiteRules {
  timezone: string;
  openMin: number;
  closeMin: number;
  horizonDays: number;
}

export type ResourceKind = "desk" | "room";

export interface RuleResource {
  id: string;
  kind: ResourceKind;
  capacity: number;
  active: boolean;
}

export interface ReserveInput {
  resourceId: string;
  date: string;
  startMin: number;
  endMin: number;
  attendees?: number | undefined;
  title?: string | undefined;
}

export interface RuleIssue {
  path: string;
  code: string;
  message: string;
}

export const DURATION_LIMITS: Record<ResourceKind, { min: number; max: number }> = {
  desk: { min: 60, max: 600 },
  room: { min: 15, max: 240 },
};
export const TITLE_MAX = 80;

/** Returns every rule violation; an empty array means the booking is allowed. */
export function validate(input: ReserveInput, resource: RuleResource, rules: SiteRules, nowMs: number): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const add = (path: string, code: string, message: string) => issues.push({ path, code, message });
  const clock = siteClock(rules.timezone, nowMs);

  if (!resource.active) add("resourceId", "inactive_resource", "This resource is not bookable right now.");

  if (!DATE_RE.test(input.date) || !isValidDate(input.date)) {
    add("date", "invalid_date", "Use a date in YYYY-MM-DD format.");
  } else {
    const offset = daysBetween(clock.date, input.date);
    if (offset < 0) add("date", "date_in_past", "That date has already passed.");
    else if (offset > rules.horizonDays) add("date", "beyond_horizon", `Bookings open ${rules.horizonDays} days ahead.`);
    if (!isWeekday(input.date)) add("date", "weekend", "The site is open Monday to Friday.");
  }

  const { startMin, endMin } = input;
  if (!Number.isInteger(startMin) || startMin % SLOT_MINUTES !== 0)
    add("startMin", "not_on_slot", "Start on a 15-minute boundary.");
  if (!Number.isInteger(endMin) || endMin % SLOT_MINUTES !== 0)
    add("endMin", "not_on_slot", "End on a 15-minute boundary.");
  if (startMin < rules.openMin) add("startMin", "before_open", "That is before the site opens.");
  if (endMin > rules.closeMin) add("endMin", "after_close", "That is after the site closes.");
  if (endMin <= startMin) {
    add("endMin", "end_before_start", "End must be after start.");
  } else {
    const limits = DURATION_LIMITS[resource.kind];
    const duration = endMin - startMin;
    if (duration < limits.min || duration > limits.max)
      add("endMin", "duration", `A ${resource.kind} booking lasts ${limits.min} to ${limits.max} minutes.`);
  }
  if (input.date === clock.date && startMin <= clock.minutes)
    add("startMin", "start_in_past", "That start time has already passed.");

  const attendees = input.attendees ?? 1;
  if (!Number.isInteger(attendees) || attendees < 1) {
    add("attendees", "attendees", "At least one attendee.");
  } else if (resource.kind === "desk" && attendees !== 1) {
    add("attendees", "attendees", "A desk is for one person.");
  } else if (resource.kind === "room" && attendees > resource.capacity) {
    add("attendees", "over_capacity", `This room holds ${resource.capacity}.`);
  }

  if (input.title !== undefined && input.title !== "") {
    if (resource.kind !== "room") add("title", "title_desk", "Only room bookings take a title.");
    else if (input.title.length > TITLE_MAX) add("title", "title_length", `Keep the title to ${TITLE_MAX} characters.`);
  }

  return issues;
}

/** Whether a booking on date at startMin has started in site-local time. */
export function hasStarted(date: string, startMin: number, rules: SiteRules, nowMs: number): boolean {
  const clock = siteClock(rules.timezone, nowMs);
  if (date < clock.date) return true;
  if (date > clock.date) return false;
  return startMin <= clock.minutes;
}
