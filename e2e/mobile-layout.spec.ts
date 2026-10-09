// Responsive layout (SPEC 12.4): at 375x812 and 768x1024 no page scrolls horizontally,
// and primary controls (buttons, form fields, nav links) are at least 44x44 px. Every
// signed-in page is checked as an admin (who can see all), and the dev login page signed out.
import { type Page, type TestInfo, expect, test } from "@playwright/test";
import { ADMIN, PAGES, VIEWPORTS, login } from "./helpers.ts";

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
