// Two browser contexts with different employees on the same date: a booking in one
// marks the slot busy in the other through the live socket (SPEC 12.4).
import { expect, test } from "@playwright/test";
import { addBusinessDays, login, longDate, siteToday } from "./helpers.ts";

test("a booking in one browser shows as busy in another", async ({ browser }) => {
  const a = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const b = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pa = await a.newPage();
  const pb = await b.newPage();
  await login(pa, "emp_011");
  await login(pb, "emp_012");
  const target = addBusinessDays(await siteToday(pa.request), 3);
  for (const p of [pa, pb]) {
    await p.goto("/find");
    await p.getByRole("gridcell", { name: longDate(target) }).click();
    await p.getByRole("tab", { name: "Rooms" }).click();
    await expect(p.getByText("Live updates on")).toBeVisible();
  }
  const cell = "Alder (10), 10:00 to 10:30";
  await expect(pb.getByRole("gridcell", { name: `${cell}, available` })).toBeVisible();

  await pa.getByRole("gridcell", { name: `${cell}, available` }).click();
  await pa.getByRole("button", { name: /^Book Alder/ }).click();
  await pa.getByRole("dialog", { name: "Book Alder" }).getByRole("button", { name: "Confirm booking" }).click();
  await expect(pa.getByRole("gridcell", { name: `${cell}, your booking` })).toBeVisible();
  // No reload in B: the delta arrives over the WebSocket.
  await expect(pb.getByRole("gridcell", { name: `${cell}, booked` })).toBeVisible({ timeout: 5000 });
  await a.close();
  await b.close();
});
