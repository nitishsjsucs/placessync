// Responsive layout (SPEC 12.4): at 375x812 and 768x1024 no page scrolls horizontally,
// and primary controls (buttons, form fields, nav links) are at least 44x44 px. Every
// signed-in page is checked as an admin (who can see all), and the dev login page signed out.
import { type Page, type TestInfo, expect, test } from "@playwright/test";
import { ADMIN, PAGES, VIEWPORTS, bookCypressToday, login } from "./helpers.ts";

async function checkLayout(page: Page, testInfo: TestInfo, name: string, viewport: string): Promise<void> {
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  const result = await page.evaluate(() => {
    const doc = document.documentElement;
    const selector = "button, select, textarea, input:not([type=checkbox]):not([type=radio]), nav a";
    const small = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && style.visibility !== "hidden" && !el.closest("[hidden]");
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { tag: el.tagName.toLowerCase(), text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40), w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
      })
      .filter((c) => c.w < 43.5 || c.h < 43.5);
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, small };
  });
  const ok = result.scrollWidth <= result.clientWidth && result.small.length === 0;
  await testInfo.attach("overflow", { body: JSON.stringify({ page: name, viewport, ok, ...result }), contentType: "application/json" });
  expect(result.scrollWidth, "no horizontal scroll").toBeLessThanOrEqual(result.clientWidth);
  expect(result.small, "controls under 44x44").toEqual([]);
}

for (const vp of VIEWPORTS) {
  test.describe(`layout at ${vp.name} ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });
    test.beforeEach(async ({ page }) => {
      await login(page, ADMIN);
    });

    for (const p of PAGES) {
      test(`${p.name}: no horizontal scroll and 44 px targets`, async ({ page }, testInfo) => {
        await page.goto(p.path);
        await checkLayout(page, testInfo, p.name, vp.name);
      });
    }

    test("staff Today's bookings tab: no horizontal scroll and 44 px targets", async ({ page }, testInfo) => {
      await bookCypressToday();
      await page.goto("/staff?tab=today");
      await expect(page.getByText(/^(Now: |Opens at |Closed now\. )|^No bookings today; every space is free\.$|^The site is closed today\.$/).first()).toBeVisible();
      await checkLayout(page, testInfo, "staff-today", vp.name);
    });

    test("admin Requests tab: no horizontal scroll and 44 px targets", async ({ page }, testInfo) => {
      await page.goto("/admin");
      await page.getByRole("tab", { name: "Requests" }).click();
      await expect(page.getByRole("heading", { name: "Time from submission to staff review" })).toBeVisible();
      await checkLayout(page, testInfo, "admin-requests", vp.name);
    });
  });

  test.describe(`layout at ${vp.name} ${vp.width}x${vp.height}, signed out`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("login: no horizontal scroll and 44 px targets", async ({ page }, testInfo) => {
      await page.goto("/login");
      await expect(page.getByRole("heading", { level: 1, name: "Sign in (local development)" })).toBeVisible();
      await checkLayout(page, testInfo, "login", vp.name);
    });
  });
}

// Find a space puts availability first on phones and tablets (UX-12), and the admin
// reports stay a sensible length with seeded history (UX-15).
test.describe("Find a space and admin on small screens", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN);
  });

  test.describe("at 375x812", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("the first time chip is on the first screen above the bottom nav, and Book stays above the nav once a time is picked", async ({ page }, testInfo) => {
      await page.goto("/find");
      // A time chip, not the By space / By time switch above the chips.
      const chip = page.getByTestId("slotgrid-compact").locator("li button:not([disabled])").first();
      await expect(chip).toBeVisible();
      await page.waitForLoadState("networkidle");
      // The first screen is the viewport above the fixed bottom nav, before any scrolling.
      const { top, bottom, visibleBottom } = await page
        .getByTestId("slotgrid-compact")
        .locator("li button")
        .first()
        .evaluate((el) => {
          const nav = document.querySelector('nav[aria-label="Main"]');
          const r = el.getBoundingClientRect();
          return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, visibleBottom: window.innerHeight - (nav?.getBoundingClientRect().height ?? 0) };
        });
      await chip.click();
      const book = page.getByRole("button", { name: /^Book / });
      await expect(book).toBeEnabled();
      const box = await book.boundingBox();
      if (!box) throw new Error("no Book button box");
      const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.textContent ?? null, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      await testInfo.attach("find-375", { body: JSON.stringify({ firstChipTop: top, firstChipBottom: bottom, visibleBottom, book: box, hit }), contentType: "application/json" });
      expect(bottom).toBeLessThanOrEqual(visibleBottom);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(812);
      expect(hit).toMatch(/^Book /);
    });

    test("find with the filters open: no horizontal scroll and 44 px targets", async ({ page }, testInfo) => {
      await page.goto("/find");
      await page.getByRole("button", { name: "Filters" }).click();
      await expect(page.getByRole("combobox", { name: "Floor" })).toBeVisible();
      await checkLayout(page, testInfo, "find-filters-open", "mobile");
    });

    test("the admin page with seeded history is under 10,000 px tall", async ({ page }, testInfo) => {
      await page.goto("/admin");
      await expect(page.getByRole("heading", { level: 1, name: "Facilities admin" })).toBeVisible();
      await expect(page.getByRole("table", { name: /^Desks: utilization by space/ }).getByRole("row").nth(1)).toBeVisible();
      await page.waitForLoadState("networkidle");
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await testInfo.attach("admin-375", { body: JSON.stringify({ height }), contentType: "application/json" });
      expect(height).toBeLessThan(10_000);
    });
  });

  test.describe("at 768x1024", () => {
    test.use({ viewport: { width: 768, height: 1024 } });

    test("the slot grid starts in the first viewport", async ({ page }) => {
      await page.goto("/find");
      const grid = page.getByRole("grid", { name: /^Availability on/ });
      await expect(grid).toBeVisible();
      await page.waitForLoadState("networkidle");
      const top = await grid.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
      expect(top).toBeLessThan(1024);
    });

    test("find with the filters open: no horizontal scroll and 44 px targets", async ({ page }, testInfo) => {
      await page.goto("/find");
      await page.getByRole("button", { name: "Filters" }).click();
      await expect(page.getByRole("combobox", { name: "Floor" })).toBeVisible();
      await checkLayout(page, testInfo, "find-filters-open", "tablet");
    });
  });
});

