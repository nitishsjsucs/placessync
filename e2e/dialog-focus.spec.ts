// Focus inside a dialog after a request fails (Chromium, not jsdom): the pressed button
// is disabled while it loads, which makes Chrome move focus to body. The dialog takes it
// back, and the failure message has it when the request fails.
import { expect, test } from "@playwright/test";
import { addBusinessDays, login, siteToday } from "./helpers.ts";

test("a booking that could not be saved keeps focus in the dialog, on the message", async ({ page }) => {
  await login(page, "emp_014");
  const date = addBusinessDays(await siteToday(page.request), 3);
  await page.goto(`/find?kind=desk&date=${date}`);
  await page.getByRole("gridcell", { name: /, 10:00 to 10:30, available$/ }).first().click();
  await page.getByRole("button", { name: /^Book / }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "Confirm booking" })).toBeFocused();
  // Long enough for Chrome to move focus off the disabled button before the failure.
  await page.route("**/api/reservations", async (route) => {
    await new Promise((r) => setTimeout(r, 300));
    await route.abort();
  });
  await page.keyboard.press("Enter");
  await expect(dialog.getByText("The booking could not be saved. Try again.")).toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.closest("[role=dialog]") !== null)).toBe(true);
});
