// The slot grid on a laptop (UX-13): at 1280x900 the 24 half-hour columns are wider than
// the panel beside the filters, and macOS draws no scrollbar. Late in the day the grid
// must open scrolled to the first column that can still be booked.
import { expect, test } from "@playwright/test";
import { isWeekdayDate, login, siteInstant, siteToday } from "./helpers.ts";

test.use({ viewport: { width: 1280, height: 900 } });

test("at 16:10 site time the 16:30 column is in view without scrolling by hand", async ({ page }, testInfo) => {
  const today = await siteToday(page.request);
  test.skip(!isWeekdayDate(today), `siteToday ${today} is a weekend, so today has no slots`);
  await page.clock.setFixedTime(siteInstant(today, 16 * 60 + 10));
  await login(page, "emp_031");
  await page.goto("/find");
  const grid = page.getByRole("grid", { name: /^Availability on/ });
  await expect(grid).toBeVisible();
  await expect(page.getByRole("gridcell", { name: "Desk 2A-01, 16:00 to 16:30, past" })).toBeVisible();
  const scroller = page.getByTestId("slotgrid-scroller");
  const header = grid.locator('th[data-start="990"]');
  const corner = grid.locator("thead th").first();
  const box = await scroller.boundingBox();
  const head = await header.boundingBox();
  const sticky = await corner.boundingBox();
  if (!box || !head || !sticky) throw new Error("no layout boxes");
  await testInfo.attach("laptop-grid", {
    body: JSON.stringify({ scroller: box, header1630: head, rowHeader: sticky, scrollLeft: await scroller.evaluate((el) => el.scrollLeft) }),
    contentType: "application/json",
  });
  // Right of the sticky row header and inside the scroller's visible box.
  expect(head.x).toBeGreaterThanOrEqual(sticky.x + sticky.width - 1);
  expect(head.x + head.width).toBeLessThanOrEqual(box.x + box.width + 1);
});
