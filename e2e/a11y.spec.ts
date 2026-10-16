// Axe gate (SPEC 12.4): every page and the /ui gallery, including an open Combobox and
// an open Dialog, at both viewports, with WCAG 2.0 A/AA, 2.1 AA and 2.2 AA rules. Any
// violation of any impact fails. No rule is excluded.
import AxeBuilder from "@axe-core/playwright";
import { type Page, type TestInfo, expect, request, test } from "@playwright/test";
import { ADMIN, PAGES, VIEWPORTS, addBusinessDays, login, longDate, siteToday } from "./helpers.ts";

const TAGS = ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"];

async function scan(page: Page, testInfo: TestInfo, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = results.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.map((n) => n.target.join(" ")) }));
  await testInfo.attach("axe", { body: JSON.stringify({ scan: label, violations: results.violations.length, details: summary }), contentType: "application/json" });
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`a11y at ${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test.beforeEach(async ({ page }) => {
      await login(page, ADMIN);
    });

    for (const p of PAGES) {
      test(`${p.name} has no axe violations`, async ({ page }, testInfo) => {
        await page.goto(p.path);
        if (p.ready) await expect(page.getByRole("heading", { level: 1, name: p.ready })).toBeVisible();
        else await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await page.waitForLoadState("networkidle");
        await scan(page, testInfo, `${p.name}@${vp.name}`);
      });
    }

    test("login page has no axe violations", async ({ page }, testInfo) => {
      await page.goto("/login");
      await expect(page.getByRole("heading", { level: 1, name: "Sign in (local development)" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await scan(page, testInfo, `login@${vp.name}`);
    });

    test("gallery with an open Combobox has no axe violations", async ({ page }, testInfo) => {
      await page.goto("/ui");
      const combo = page.getByRole("combobox", { name: "Room", exact: true });
      await combo.click();
      await combo.press("ArrowDown");
      await expect(combo).toHaveAttribute("aria-expanded", "true");
      await scan(page, testInfo, `ui-combobox-open@${vp.name}`);
    });

    test("gallery with an open Dialog has no axe violations", async ({ page }, testInfo) => {
      await page.goto("/ui");
      await page.getByRole("button", { name: "Open dialog" }).click();
      await expect(page.getByRole("dialog", { name: "Gallery dialog" })).toBeVisible();
      await scan(page, testInfo, `ui-dialog-open@${vp.name}`);
    });

    test("admin Resources tab and staff Today's bookings tab have no axe violations", async ({ page }, testInfo) => {
      await page.goto("/admin");
      await page.getByRole("tab", { name: "Resources" }).click();
      await expect(page.getByRole("table", { name: "Resources" })).toBeVisible();
      await expect(page.getByRole("button", { name: /^Deactivate/ }).first()).toBeVisible();
      await scan(page, testInfo, `admin-resources@${vp.name}`);
      await page.goto("/staff");
      await page.getByRole("tab", { name: "Today's bookings" }).click();
      await expect(page.getByRole("table", { name: /^Bookings today/ })).toBeVisible();
      await scan(page, testInfo, `staff-today@${vp.name}`);
    });

    test("find with the filter disclosure open has no axe violations", async ({ page }, testInfo) => {
      await page.goto("/find");
      await page.getByRole("button", { name: "Filters" }).click();
      await expect(page.getByRole("button", { name: "Filters" })).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("combobox", { name: "Floor" })).toBeVisible();
      await page.waitForLoadState("networkidle");
      await scan(page, testInfo, `find-filters-open@${vp.name}`);
    });

    test("the result banner after a booking has no axe violations", async ({ page }, testInfo) => {
      // Each viewport books its own room and hour, so the two runs never collide.
      const room = vp.width < 640 ? { id: "res_juniper", name: "Juniper", time: "15:00 to 15:30" } : { id: "res_redwood", name: "Redwood", time: "16:00 to 16:30" };
      const date = addBusinessDays(await siteToday(page.request), 5);
      await page.goto(`/resources/${room.id}?date=${date}`);
      await expect(page.getByRole("heading", { level: 1, name: room.name })).toBeVisible();
      if (vp.width < 640) {
        await page.getByRole("combobox", { name: "Day" }).selectOption(date);
        await page.getByRole("button", { name: room.time, exact: true }).click();
      } else {
        await page.getByRole("gridcell", { name: new RegExp(`, ${room.time}, available$`) }).and(page.locator(`[data-row="${date}"]`)).click();
      }
      await page.getByRole("button", { name: /^Book / }).click();
      await page.getByRole("dialog", { name: `Book ${room.name}` }).getByRole("button", { name: "Confirm booking" }).click();
      await expect(page.getByTestId("status-banner")).toContainText(`Booked ${room.name} on ${longDate(date)}`);
      await scan(page, testInfo, `booking-banner@${vp.name}`);
    });

    test("the booking dialog after a lost race has no axe violations", async ({ page }, testInfo) => {
      const slot = vp.width < 640 ? { time: "17:00 to 17:30", start: 1020, rival: "emp_051" } : { time: "17:30 to 18:00", start: 1050, rival: "emp_052" };
      const date = addBusinessDays(await siteToday(page.request), 6);
      await page.goto(`/resources/res_alder?date=${date}`);
      await expect(page.getByRole("heading", { level: 1, name: "Alder" })).toBeVisible();
      if (vp.width < 640) {
        await page.getByRole("combobox", { name: "Day" }).selectOption(date);
        await page.getByRole("button", { name: slot.time, exact: true }).click();
      } else {
        await page.getByRole("gridcell", { name: new RegExp(`, ${slot.time}, available$`) }).and(page.locator(`[data-row="${date}"]`)).click();
      }
      await page.getByRole("button", { name: /^Book / }).click();
      const dialog = page.getByRole("dialog", { name: "Book Alder" });
      await expect(dialog).toBeVisible();
      // Someone else takes the same half hour while the dialog is open.
      const rival = await request.newContext({ baseURL: "http://localhost:8783" });
      await rival.post("/api/dev/login", { data: { employeeId: slot.rival } });
      const taken = await rival.post("/api/reservations", {
        headers: { "Idempotency-Key": `a11y-race-${date}-${slot.start}` },
        data: { resourceId: "res_alder", date, startMin: slot.start, endMin: slot.start + 30, attendees: 1 },
      });
      expect(taken.status()).toBe(201);
      await rival.dispose();
      await dialog.getByRole("button", { name: "Confirm booking" }).click();
      await expect(dialog.getByRole("button", { name: "Pick another time" })).toBeVisible();
      await expect(dialog.getByText(/^Someone else booked this first/)).toBeVisible();
      await scan(page, testInfo, `booking-conflict@${vp.name}`);
    });

    test("booking dialog has no axe violations", async ({ page }, testInfo) => {
      await page.goto("/resources/res_madrone");
      await expect(page.getByRole("heading", { level: 1, name: "Madrone" })).toBeVisible();
      await page.getByRole("button", { name: "Next week" }).click();
      if (vp.width < 640) {
        await page.getByRole("button", { name: "13:00 to 13:30" }).first().click();
      } else {
        await page.getByRole("gridcell", { name: /^Wednesday .*, 13:00 to 13:30, available$/ }).click();
      }
      await page.getByRole("button", { name: /^Book / }).click();
      await expect(page.getByRole("dialog", { name: "Book Madrone" })).toBeVisible();
      await scan(page, testInfo, `booking-dialog@${vp.name}`);
    });
  });
}
