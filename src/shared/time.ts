// Site-local date and slot math. Dates are site-local calendar dates as YYYY-MM-DD
// strings; times of day are minutes since local midnight. Wall-clock conversion uses
// Intl with the site's IANA time zone, so nothing depends on the host's zone.

export const SLOT_MINUTES = 15;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The site-local wall clock at an instant: { date: "YYYY-MM-DD", minutes: 0..1439 }. */
export function siteClock(timeZone: string, nowMs: number): { date: string; minutes: number } {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(new Date(nowMs))) parts[p.type] = p.value;
  const hour = Number(parts.hour) % 24;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: hour * 60 + Number(parts.minute),
  };
}

export function siteToday(timeZone: string, nowMs: number): string {
  return siteClock(timeZone, nowMs).date;
}

/** The instant (ms since epoch) at which `date` begins in `timeZone`: site-local midnight. */
export function siteMidnightUtc(timeZone: string, date: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  let guess = target;
  // Move by the zone offset seen at the guess; a second pass settles an offset change
  // between the guess and the answer (DST).
  for (let i = 0; i < 3; i++) {
    const c = siteClock(timeZone, guess);
    const diff = Date.parse(`${c.date}T00:00:00Z`) + c.minutes * 60_000 - target;
    if (diff === 0) return guess;
    guess -= diff;
  }
  return guess;
}

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function toUtcDays(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

function fromUtcDays(days: number): string {
  return new Date(days * 86_400_000).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
  return fromUtcDays(toUtcDays(date) + n);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return toUtcDays(b) - toUtcDays(a);
}

/** 0 = Sunday .. 6 = Saturday. */
export function dayOfWeek(date: string): number {
  return new Date(toUtcDays(date) * 86_400_000).getUTCDay();
}

export function isWeekday(date: string): boolean {
  const d = dayOfWeek(date);
  return d >= 1 && d <= 5;
}

/** The n-th business day strictly after date (n >= 1). */
export function addBusinessDays(date: string, n: number): string {
  let d = date;
  let left = n;
  while (left > 0) {
    d = addDays(d, 1);
    if (isWeekday(d)) left--;
  }
  return d;
}

/** The n business days strictly before date, oldest first. */
export function previousBusinessDays(date: string, n: number): string[] {
  const out: string[] = [];
  let d = date;
  while (out.length < n) {
    d = addDays(d, -1);
    if (isWeekday(d)) out.unshift(d);
  }
  return out;
}

/** Monday of the week that contains date. */
export function weekStartOf(date: string): string {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

export function slotOf(minute: number): number {
  return Math.floor(minute / SLOT_MINUTES);
}

/** Slot numbers covered by [startMin, endMin). 09:00 to 10:00 gives 36, 37, 38, 39. */
export function slotsFor(startMin: number, endMin: number): number[] {
  const out: number[] = [];
  for (let s = slotOf(startMin); s < slotOf(endMin); s++) out.push(s);
  return out;
}

export function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
