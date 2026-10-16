// The staff day timeline (VIZ-02) where layout matters. Between 640 and about 880 px the
// chart scrolls sideways inside its own frame, so a keyboard move must bring the focused
// booking, and the text beside it, into the frame's visible part. On the time axis the
// "Now hh:mm" label must stay inside the chart and clear of every hour label.
import { type Locator, type Page, expect, test } from "@playwright/test";
import { STAFF, bookCypressToday, bookLateToday, login, siteInstant, siteToday } from "./helpers.ts";

const formatMinutes = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

async function box(locator: Locator) {
  const b = await locator.boundingBox();
  if (!b) throw new Error("no layout box");
  return { left: b.x, right: b.x + b.width };
}

/** Moves the chart's focus down to the row whose announcement starts with the space's name. */
async function focusRow(page: Page, chart: Locator, space: string): Promise<void> {
  const live = page.getByTestId("timeline-frame").locator("[aria-live=polite]");
  for (let i = 0; i < 30; i++) {
    if ((await live.textContent())?.startsWith(space)) return;
    await chart.press("ArrowDown");
  }
  throw new Error(`no row for ${space}`);
}

test.describe("at 768x1024, where the chart scrolls inside its frame", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("End on a booking after 17:00 scrolls it, and its text, into the frame", async ({ page }, testInfo) => {
    const start = await bookLateToday();
    test.skip(start === null, "a weekend, or after 18:00 site time: no hour after 17:00 is left to book today");
    await login(page, STAFF);
    await page.goto("/staff?tab=today");
    const chart = page.getByRole("group", { name: /^Bookings by space/ });
    await expect(chart).toBeVisible();
    await page.waitForLoadState("networkidle");
    const frame = page.getByTestId("timeline-frame");
    const sizes = await frame.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
    expect(sizes.scrollWidth, "the chart is wider than its frame at 768 px").toBeGreaterThan(sizes.clientWidth);
    await chart.focus();
    await focusRow(page, chart, "Sequoia");
    await chart.press("End");
    const tip = page.getByTestId("timeline-tooltip");
    await expect(tip).toContainText(`Sequoia, ${formatMinutes(start as number)} to ${formatMinutes((start as number) + 60)}, `);
    await expect(tip).toContainText("6 attending, Quarterly planning review with the workplace team");
    const bar = page.locator("[data-focused=bar]");
    // The space names stay put on the left, so what shows of the track starts at their edge.
    const names = chart.getByText("Space", { exact: true });
    const [f, n, b, t, scrollLeft] = await Promise.all([box(frame), box(names), box(bar), box(tip), frame.evaluate((el) => el.scrollLeft)]);
    await testInfo.attach("timeline-frame", { body: JSON.stringify({ start, frame: f, names: n, bar: b, tooltip: t, scrollLeft, ...sizes }), contentType: "application/json" });
    expect(scrollLeft).toBeGreaterThan(0);
    for (const [name, r] of [["bar", b], ["tooltip", t]] as const) {
      expect(r.left, `${name} left`).toBeGreaterThanOrEqual(n.right);
      expect(r.right, `${name} right`).toBeLessThanOrEqual(f.right);
    }
  });
});

test.describe("at 1280x900, the Now label on the time axis", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  for (const minutes of [11 * 60 + 45, 18 * 60 + 50]) {
    test(`at ${formatMinutes(minutes)} it stays inside the chart and covers no hour label`, async ({ page }, testInfo) => {
      const today = await siteToday(page.request);
      await bookCypressToday();
      await bookLateToday();
      await page.clock.setFixedTime(siteInstant(today, minutes));
      await login(page, STAFF);
      await page.goto("/staff?tab=today");
      await expect(page.getByText(/^(Now: |Opens at |Closed now\. )|^No bookings today; every space is free\.$|^The site is closed today\.$/).first()).toBeVisible();
      const chart = page.getByRole("group", { name: /^Bookings by space/ });
      test.skip((await chart.count()) === 0, "no booking today to draw (a weekend, or too late to book one)");
      const pill = page.getByTestId("now-label");
      await expect(pill).toHaveText(`Now ${formatMinutes(minutes)}`);
      const frame = await box(page.getByTestId("timeline-frame"));
      const p = await box(pill);
      const ticks = await chart.locator("[data-tick]").evaluateAll((els) => els.map((el) => ({ text: el.textContent, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right })));
      await testInfo.attach("now-label", { body: JSON.stringify({ frame, pill: p, ticks }), contentType: "application/json" });
      expect(p.left).toBeGreaterThanOrEqual(frame.left);
      expect(p.right).toBeLessThanOrEqual(frame.right);
      expect(ticks.length).toBeGreaterThanOrEqual(4);
      for (const t of ticks) expect(t.right <= p.left || t.left >= p.right, `${t.text} against the Now label`).toBe(true);
    });
  }
});
