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

// Tier 2: propagation latency over 20 bookings, from the booking request in one browser
// context to the busy cell in another (local, Chromium only).
test("realtime propagation latency over 20 bookings", async ({ browser }, testInfo) => {
  const a = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const b = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pa = await a.newPage();
  const pb = await b.newPage();
  await login(pa, "emp_021");
  await login(pb, "emp_022");
  const target = addBusinessDays(await siteToday(pa.request), 4);
  await pb.goto("/find");
  await pb.getByRole("gridcell", { name: longDate(target) }).click();
  await pb.getByRole("tab", { name: "Rooms" }).click();
  await expect(pb.getByText("Live updates on")).toBeVisible();
  const rooms = [
    { id: "res_redwood", label: "Redwood (4)" },
    { id: "res_sequoia", label: "Sequoia (8)" },
    { id: "res_juniper", label: "Juniper (6)" },
    { id: "res_alder", label: "Alder (10)" },
    { id: "res_madrone", label: "Madrone (12)" },
  ];
  const samples: number[] = [];
  for (let i = 0; i < 20; i++) {
    const room = rooms[i % rooms.length] as { id: string; label: string };
    // Consecutive half hours, so one organizer never holds two rooms at once.
    const start = 420 + i * 30;
    const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
    const cell = pb.getByRole("gridcell", { name: `${room.label}, ${hhmm(start)} to ${hhmm(start + 30)}, booked` });
    const t0 = Date.now();
    const res = await pa.request.post("/api/reservations", {
      headers: { "Idempotency-Key": `latency-${target}-${i}` },
      data: { resourceId: room.id, date: target, startMin: start, endMin: start + 30, attendees: 1 },
    });
    expect(res.status()).toBe(201);
    await expect(cell).toBeVisible({ timeout: 5000 });
    samples.push(Date.now() - t0);
  }
  const sorted = [...samples].sort((x, y) => x - y);
  const pct = (p: number) => {
    const rank = (p / 100) * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    return (sorted[lo] as number) + ((sorted[hi] as number) - (sorted[lo] as number)) * (rank - lo);
  };
  await testInfo.attach("latency", {
    body: JSON.stringify({ bookings: samples.length, samplesMs: samples, p50: pct(50), p95: pct(95), note: "request start in one context to busy cell visible in another, local Chromium" }),
    contentType: "application/json",
  });
  await a.close();
  await b.close();
});
