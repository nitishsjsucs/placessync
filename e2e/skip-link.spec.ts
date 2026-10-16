// The second skip link on Find a space (UX-14). Kept out of keyboard-booking.spec.ts,
// whose tests the results reporter counts as the keyboard-only booking path.
import { expect, test } from "@playwright/test";
import { login } from "./helpers.ts";

test("Skip to availability reaches the slot grid in four key presses", async ({ page }) => {
  await login(page, "emp_043");
  await page.goto("/find");
  await expect(page.getByRole("grid", { name: /^Availability on/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to availability" })).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(page.locator('table[role=grid][aria-label^="Availability"] [role=gridcell][tabindex="0"]')).toBeFocused();
});
