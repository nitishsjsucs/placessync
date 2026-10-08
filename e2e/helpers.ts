import type { APIRequestContext, Page } from "@playwright/test";

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
