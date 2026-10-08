// Keyboard-only booking and cancellation (SPEC 12.4). The sign-in uses the dev API; every
// step after that uses only the keyboard.
import { expect, test } from "@playwright/test";
import { addBusinessDays, login, longDate, siteToday } from "./helpers.ts";

test("book a desk and cancel it using only the keyboard", async ({ page }, testInfo) => {
  await login(page, "emp_042");
  const today = await siteToday(page.request);
  const target = addBusinessDays(today, 2);
  await page.goto("/find");
  await expect(page.getByRole("heading", { level: 1, name: "Find a space" })).toBeVisible();
  await page.waitForLoadState("networkidle");

  // Reach the DateGrid's single tab stop and move to the target date with arrows.
  const dateCell = page.getByRole("gridcell", { name: longDate(target) });
  const selected = page.locator('[role=grid] [role=gridcell][tabindex="0"]').first();
  for (let i = 0; i < 40 && !(await selected.evaluate((el) => el === document.activeElement).catch(() => false)); i++) await page.keyboard.press("Tab");
  await expect(selected).toBeFocused();
  for (let i = 0; i < 10 && !(await dateCell.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("ArrowRight");
  await expect(dateCell).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dateCell).toHaveAttribute("aria-selected", "true");

  // Desks tab, then into the SlotGrid.
  const desks = page.getByRole("tab", { name: "Desks" });
  for (let i = 0; i < 60 && !(await desks.evaluate((el) => el === document.activeElement).catch(() => false)); i++) {
    await page.keyboard.press("Tab");
    if (await page.getByRole("tab", { name: "All spaces" }).evaluate((el) => el === document.activeElement)) await page.keyboard.press("ArrowRight");
  }
  await expect(desks).toBeFocused();
  await expect(desks).toHaveAttribute("aria-selected", "true");
  const firstCell = page.getByRole("gridcell", { name: "Desk 2B-04, 07:00 to 07:30, available" });
  await expect(firstCell).toBeVisible();
  const slotTabStop = page.locator('table[role=grid][aria-label^="Availability"] [role=gridcell][tabindex="0"]');
  for (let i = 0; i < 10 && !(await slotTabStop.evaluate((el) => el === document.activeElement).catch(() => false)); i++) await page.keyboard.press("Tab");
  await expect(slotTabStop).toBeFocused();
  // Move to the Desk 2B-04 row (8th desk), 15:00 (column 16), then extend to 16:00.
  for (let i = 0; i < 7; i++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  for (let i = 0; i < 16; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("gridcell", { name: "Desk 2B-04, 15:00 to 15:30, available" })).toBeFocused();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Enter");
  const book = page.getByRole("button", { name: "Book Desk 2B-04, 15:00 to 16:00" });
  await expect(book).toBeEnabled();
  for (let i = 0; i < 10 && !(await book.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(book).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Book Desk 2B-04" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirm booking" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("announcer")).toHaveText(`Booked Desk 2B-04 on ${longDate(target)}, 15:00 to 16:00.`);

  // Cancel it from My bookings, keyboard only.
  await page.goto("/bookings");
  const cancel = page.getByRole("button", { name: `Cancel booking for Desk 2B-04 on ${longDate(target)}` });
  await expect(cancel).toBeVisible();
  for (let i = 0; i < 40 && !(await cancel.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", { name: "Cancel this booking?" });
  await expect(confirm.getByRole("button", { name: "Keep booking" })).toBeFocused();
  // The reason field comes before the buttons in the dialog.
  await page.keyboard.press("Shift+Tab");
  await expect(confirm.getByRole("textbox", { name: "Reason (optional)" })).toBeFocused();
  await page.keyboard.type("Plans changed");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "Cancel booking" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(confirm).toBeHidden();
  await expect(page.getByText("No upcoming bookings. Find a space to book one.")).toBeVisible();
  await testInfo.attach("keyboard", { body: JSON.stringify({ path: "book-and-cancel", date: target, ok: true }), contentType: "application/json" });
});
