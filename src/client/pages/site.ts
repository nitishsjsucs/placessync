// Site rules for the client, from /api/health (SPEC 7.1: the client validates inline
// with the same pure rules the ledger runs).
import { DURATION_LIMITS, type SiteRules } from "../../shared/rules.ts";
import { addDays, daysBetween, formatMinutes, isWeekday, siteClock } from "../../shared/time.ts";
import { useReadySession } from "../session/SessionProvider.tsx";

export interface SiteContext {
  siteId: string;
  today: string;
  rules: SiteRules;
}

const FALLBACK_RULES: SiteRules = { timezone: "America/Los_Angeles", openMin: 420, closeMin: 1140, horizonDays: 14 };

export function useSite(): SiteContext {
  const { health } = useReadySession();
  const rules = health.siteRules ?? FALLBACK_RULES;
  return { siteId: health.siteId, today: health.siteToday ?? siteClock(rules.timezone, Date.now()).date, rules };
}

export function dateDisabledReason(date: string, site: SiteContext): string | null {
  const offset = daysBetween(site.today, date);
  if (offset < 0) return "This date has passed.";
  if (offset > site.rules.horizonDays) return `Bookings open ${site.rules.horizonDays} days ahead.`;
  if (!isWeekday(date)) return "The site is closed on weekends.";
  return null;
}

/** The first bookable date from today on. */
export function firstBookableDate(site: SiteContext): string {
  let d = site.today;
  for (let i = 0; i <= site.rules.horizonDays; i++) {
    if (!dateDisabledReason(d, site)) return d;
    d = addDays(d, 1);
  }
  return site.today;
}

/** On today, slots that have started are not selectable. */
export function minStartOn(date: string, site: SiteContext): number {
  if (date !== site.today) return -1;
  return siteClock(site.rules.timezone, Date.now()).minutes;
}

export function timeRange(startMin: number, endMin: number): string {
  return `${formatMinutes(startMin)} to ${formatMinutes(endMin)}`;
}

export function durationHint(kind: "desk" | "room"): string {
  const l = DURATION_LIMITS[kind];
  return `${kind === "desk" ? "Desks" : "Rooms"} book for ${l.min} to ${l.max} minutes.`;
}
