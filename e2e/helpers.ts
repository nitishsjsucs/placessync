import { type APIRequestContext, type Page, request as playwrightRequest } from "@playwright/test";

export const ADMIN = "emp_100";
export const STAFF = "emp_093";

/** Signs in through the dev login route; the cookie lands in the page's context. */
export async function login(page: Page, employeeId: string): Promise<void> {
  const res = await page.request.post("/api/dev/login", { data: { employeeId } });
  if (!res.ok()) throw new Error(`login failed: ${res.status()}`);
}

export async function siteToday(request: APIRequestContext): Promise<string> {
  const res = await request.get("/api/health");
  const body = (await res.json()) as { siteToday: string };
  return body.siteToday;
}

/** The n-th business day after the given date. */
export function addBusinessDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) left--;
  }
  return d.toISOString().slice(0, 10);
}

export function isWeekdayDate(date: string): boolean {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dow !== 0 && dow !== 6;
}

/** The UTC instant at which the hq clock (America/Los_Angeles) reads this date and minute. */
export function siteInstant(date: string, minutes: number, timeZone = "America/Los_Angeles"): number {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  for (let off = -14 * 60; off <= 14 * 60; off += 15) {
    const ms = Date.UTC(y, m - 1, d) + (minutes - off) * 60_000;
    const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    if (`${parts.year}-${parts.month}-${parts.day}` === date && Number(parts.hour) * 60 + Number(parts.minute) === minutes) return ms;
  }
  throw new Error(`no instant for ${date} ${minutes}`);
}

export function longDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

export const VIEWPORTS = [
  { name: "mobile", width: 375, height: 812 },
  { name: "tablet", width: 768, height: 1024 },
] as const;

/** Every page the a11y and layout specs visit (signed in as an admin, who can see all). */
export const PAGES = [
  { name: "find", path: "/find", ready: "Find a space" },
  { name: "resource", path: "/resources/res_sequoia", ready: "Sequoia" },
  { name: "bookings", path: "/bookings", ready: "My bookings" },
  { name: "report-issue", path: "/requests/new", ready: "Report an issue" },
  { name: "my-requests", path: "/requests", ready: "My requests" },
  { name: "request-detail", path: "/requests/req_seed_001", ready: null },
  { name: "staff", path: "/staff", ready: "Facilities staff" },
  { name: "admin", path: "/admin", ready: "Facilities admin" },
  { name: "ui-gallery", path: "/ui", ready: "UI kit gallery" },
  { name: "not-found", path: "/no-such-page", ready: "Page not found" },
] as const;

/** The site's wall clock now: { date, minutes }. */
export function siteNow(timeZone = "America/Los_Angeles"): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/**
 * Best effort: books Cypress for the next half hour today as emp_077, so the staff
 * timeline has a bar to draw. Does nothing on a weekend or after the last slot (the
 * timeline then shows its closed or empty state, which the scans cover too). No other
 * spec books today or uses this space and person.
 */
export async function bookCypressToday(): Promise<string> {
  // Its own request context: signing in as emp_077 must not replace the page's session.
  const ctx = await playwrightRequest.newContext({ baseURL: "http://localhost:8783" });
  try {
    const health = (await (await ctx.get("/api/health")).json()) as { siteToday: string; siteRules: { timezone: string; closeMin: number } };
    const now = siteNow(health.siteRules.timezone);
    const start = Math.max(7 * 60, Math.ceil((now.minutes + 1) / 30) * 30);
    if (now.date !== health.siteToday || !isWeekdayDate(health.siteToday) || start + 30 > health.siteRules.closeMin) return "not bookable now";
    const login = await ctx.post("/api/dev/login", { data: { employeeId: "emp_077" } });
    if (!login.ok()) return `login ${login.status()}`;
    const res = await ctx.post("/api/reservations", {
      headers: { "Idempotency-Key": `e2e-timeline-${health.siteToday}-${start}` },
      data: { resourceId: "res_cypress", date: health.siteToday, startMin: start, endMin: start + 30, attendees: 2, title: "e2e timeline" },
    });
    return `booked ${res.status()}`;
  } finally {
    await ctx.dispose();
  }
}

/**
 * Books Sequoia for an hour from 17:30 today (or the next half hour, if later) as emp_078,
 * so the staff timeline has a booking past the right edge of its frame at 768 px. Returns
 * the booked start in minutes, or null on a weekend or after 18:00 site time, when no
 * such hour is left. No other spec books Sequoia today or signs in as emp_078.
 */
export async function bookLateToday(): Promise<number | null> {
  const ctx = await playwrightRequest.newContext({ baseURL: "http://localhost:8783" });
  try {
    const health = (await (await ctx.get("/api/health")).json()) as { siteToday: string; siteRules: { timezone: string; closeMin: number } };
    const now = siteNow(health.siteRules.timezone);
    const start = Math.max(17 * 60 + 30, Math.ceil((now.minutes + 1) / 30) * 30);
    if (now.date !== health.siteToday || !isWeekdayDate(health.siteToday) || start + 60 > health.siteRules.closeMin) return null;
    const login = await ctx.post("/api/dev/login", { data: { employeeId: "emp_078" } });
    if (!login.ok()) throw new Error(`login ${login.status()}`);
    const res = await ctx.post("/api/reservations", {
      headers: { "Idempotency-Key": `e2e-late-${health.siteToday}-${start}` },
      data: { resourceId: "res_sequoia", date: health.siteToday, startMin: start, endMin: start + 60, attendees: 6, title: "Quarterly planning review with the workplace team" },
    });
    if (res.status() !== 201 && res.status() !== 200) throw new Error(`late booking ${res.status()}: ${await res.text()}`);
    return start;
  } finally {
    await ctx.dispose();
  }
}
