// Axe gate (SPEC 12.4): every page and the /ui gallery, including an open Combobox and
// an open Dialog, at both viewports, with WCAG 2.0 A/AA, 2.1 AA and 2.2 AA rules. Any
// violation of any impact fails. No rule is excluded.
import AxeBuilder from "@axe-core/playwright";
import { type Page, type TestInfo, expect, test } from "@playwright/test";
import { ADMIN, PAGES, VIEWPORTS, login } from "./helpers.ts";

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
